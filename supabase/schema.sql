-- =====================================================================
-- GESTÃO PET PUPPY — banco de dados (tabelas com prefixo pp_)
-- Roda no projeto Supabase da Tudo Mix, isolado por RLS próprio.
-- Idempotente: pode ser executado de novo sem apagar dados.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Perfis e permissões
-- ---------------------------------------------------------------------
create table if not exists pp_perfis(
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nome text,
  papel text check (papel in ('master','financeiro','compras','estoque','operacao')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  ultimo_acesso timestamptz
);

create or replace function pp_papel() returns text language sql stable security definer set search_path=public as $$
  select papel from pp_perfis where user_id=auth.uid() and ativo
$$;
create or replace function pp_master() returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(pp_papel()='master',false)
$$;
create or replace function pp_tem(variadic papeis text[]) returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(pp_papel() = any(papeis) or pp_papel()='master',false)
$$;
-- quem vê custos/margens: master, financeiro, compras
create or replace function pp_ve_custo() returns boolean language sql stable as $$ select pp_tem('financeiro','compras') $$;
-- quem vê financeiro (caixa, contas): master, financeiro
create or replace function pp_ve_fin() returns boolean language sql stable as $$ select pp_tem('financeiro') $$;
create or replace function pp_logado() returns boolean language sql stable as $$ select pp_papel() is not null $$;

-- Cria o perfil (pendente) do usuário logado; o e-mail do dono vira master
create or replace function pp_entrar() returns pp_perfis language plpgsql security definer set search_path=public as $$
declare r pp_perfis; v_email text;
begin
  select email into v_email from auth.users where id=auth.uid();
  if v_email is null then raise exception 'Não autenticado'; end if;
  insert into pp_perfis(user_id,email,nome,papel)
  values (auth.uid(),v_email,coalesce((select raw_user_meta_data->>'nome' from auth.users where id=auth.uid()),split_part(v_email,'@',1)),
          case when lower(v_email) in ('iagobrito@tudomixatacado.com') then 'master' end)
  on conflict (user_id) do update set ultimo_acesso=now()
  returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 2. Estrutura: empresas, unidades, locais, configuração
-- ---------------------------------------------------------------------
create table if not exists pp_empresas(
  id serial primary key, nome text not null, razao_social text, cnpj text unique, ativa boolean not null default true);
create table if not exists pp_unidades(
  id serial primary key, empresa_id int not null references pp_empresas(id), nome text not null, ativa boolean not null default true);
create table if not exists pp_locais(
  id serial primary key, unidade_id int references pp_unidades(id), empresa_id int not null references pp_empresas(id),
  nome text not null,
  tipo text not null default 'loja' check (tipo in ('loja','deposito','full','transito','espelho')),
  -- 'espelho' = estoque que aparece em outro sistema mas são as MESMAS unidades físicas (não soma)
  ml_conta_id int, ativo boolean not null default true);
create table if not exists pp_config(chave text primary key, valor jsonb not null, atualizado_em timestamptz default now(), atualizado_por uuid);

insert into pp_config(chave,valor) values
 ('fuso','"America/Sao_Paulo"'),
 ('rateio_frete','"valor"'),           -- 'valor' (proporcional ao valor do item) ou 'quantidade'
 ('custo_inclui_ipi','true'),
 ('custo_inclui_st','true'),
 ('custo_inclui_frete','true'),
 ('custo_inclui_seguro_outras','true'),
 ('tributos_validado_contabilidade','false'),
 ('cobertura_minima_dias','15'),
 ('sem_movimento_dias','60'),
 ('validade_alerta_dias','45'),
 ('ml_app_id','""')
on conflict (chave) do nothing;

insert into pp_empresas(nome,razao_social,cnpj) values
 ('Pet Puppy','LH VEZONI COMERCIO DE RACOES PARA ANIMAIS LTDA','15176325000105')
on conflict (cnpj) do nothing;
insert into pp_unidades(empresa_id,nome) select id,'Loja Aclimação' from pp_empresas e where cnpj='15176325000105'
  and not exists (select 1 from pp_unidades u where u.empresa_id=e.id);
insert into pp_locais(unidade_id,empresa_id,nome,tipo) select u.id,u.empresa_id,'Loja (SimplesVet)','loja' from pp_unidades u
  where u.nome='Loja Aclimação' and not exists (select 1 from pp_locais l where l.unidade_id=u.id);

-- ---------------------------------------------------------------------
-- 3. Cadastro mestre de produtos e vínculos de códigos
-- ---------------------------------------------------------------------
create table if not exists pp_produtos(
  id uuid primary key default gen_random_uuid(),
  nome text not null, categoria text, marca text, unidade text not null default 'UN',
  ean text, ncm text, eh_kit boolean not null default false,
  estoque_minimo numeric, ativo boolean not null default true,
  criado_em timestamptz not null default now(), criado_por uuid default auth.uid());
create index if not exists pp_produtos_ean on pp_produtos(ean);

create table if not exists pp_kit_itens(
  kit_id uuid references pp_produtos(id) on delete cascade, componente_id uuid references pp_produtos(id),
  qtd numeric not null check (qtd>0), primary key(kit_id,componente_id));

-- Cada código externo aponta para UM produto do cadastro mestre.
-- fator = quantas unidades do produto mestre esse código representa (caixa com 12 → 12).
create table if not exists pp_codigos(
  id bigserial primary key,
  produto_id uuid references pp_produtos(id) on delete cascade,
  origem text not null check (origem in ('simplesvet','ml_sku','ml_item','ml_variacao','fornecedor','ean','interno')),
  escopo text not null default '',      -- conta ML, CNPJ do fornecedor etc.
  codigo text not null,
  descricao text, fator numeric not null default 1 check (fator>0),
  status text not null default 'confirmado' check (status in ('confirmado','sugerido','rejeitado')),
  motivo_sugestao text, confirmado_por uuid, confirmado_em timestamptz,
  unique(origem,escopo,codigo));
create index if not exists pp_codigos_prod on pp_codigos(produto_id);

-- ---------------------------------------------------------------------
-- 4. Contas do Mercado Livre (tokens ficam em tabela sem acesso pelo site)
-- ---------------------------------------------------------------------
create table if not exists pp_ml_contas(
  id serial primary key, empresa_id int not null references pp_empresas(id), apelido text not null,
  ml_user_id bigint unique, nickname text, status text not null default 'nao_conectada',
  baixa_estoque_nao_full text not null default 'simplesvet' check (baixa_estoque_nao_full in ('simplesvet','sistema')),
  conectada_em timestamptz, ultima_sync timestamptz);
alter table pp_ml_contas add column if not exists saldo_disponivel numeric;
alter table pp_ml_contas add column if not exists saldo_a_liberar numeric;
alter table pp_ml_contas add column if not exists saldo_bloqueado numeric;
alter table pp_ml_contas add column if not exists saldo_em timestamptz;
create table if not exists pp_ml_tokens(
  conta_id int primary key references pp_ml_contas(id) on delete cascade,
  access_token text, refresh_token text, expira_em timestamptz, atualizado_em timestamptz default now());
create table if not exists pp_ml_oauth(conta_id int primary key references pp_ml_contas(id) on delete cascade, state text not null, criado_em timestamptz default now());
alter table pp_ml_oauth enable row level security;
create or replace function pp_ml_iniciar_oauth(p_conta int) returns text language plpgsql security definer set search_path=public as $$
declare s text;
begin
  if not pp_master() then raise exception 'Somente o administrador conecta contas'; end if;
  s:=p_conta||'.'||encode(gen_random_bytes(18),'hex');
  insert into pp_ml_oauth values (p_conta,s,now()) on conflict (conta_id) do update set state=excluded.state,criado_em=now();
  return s;
end $$;
insert into pp_ml_contas(empresa_id,apelido) select id,'Pet Puppy' from pp_empresas where cnpj='15176325000105'
  and not exists (select 1 from pp_ml_contas where apelido='Pet Puppy');

create table if not exists pp_ml_anuncios(
  conta_id int references pp_ml_contas(id), item_id text, variacao_id text not null default '',
  titulo text, sku text, preco numeric, status text, logistica text, inventory_id text,
  estoque_disponivel numeric, estoque_full numeric, produto_id uuid references pp_produtos(id),
  atualizado_em timestamptz default now(), primary key(conta_id,item_id,variacao_id));

-- ---------------------------------------------------------------------
-- 5. Notas fiscais (entrada e saída)
-- ---------------------------------------------------------------------
create table if not exists pp_notas(
  id bigserial primary key,
  tipo text not null check (tipo in ('entrada','saida')),
  empresa_id int references pp_empresas(id), unidade_id int references pp_unidades(id),
  parceiro_nome text, parceiro_doc text,
  modelo text, numero text, serie text, chave text unique,
  emissao timestamptz, data_entrada date,
  situacao text not null default 'autorizada' check (situacao in ('autorizada','cancelada','denegada','em_digitacao','desconhecida')),
  natureza text, eh_bonificacao boolean not null default false,
  nota_relacionada_id bigint references pp_notas(id),   -- bonificação → compra
  valor_produtos numeric, desconto numeric default 0, frete numeric default 0, seguro numeric default 0, outras numeric default 0,
  ipi numeric default 0, icms_st numeric default 0, icms numeric default 0, pis numeric default 0, cofins numeric default 0,
  valor_total numeric,
  despesa_extra numeric not null default 0, despesa_extra_desc text,   -- ex.: CT-e pago à parte, rateado pela regra
  origem text not null default 'xml' check (origem in ('xml','manual','imagem')),
  conferida boolean not null default true,   -- notas por leitura de imagem entram como false
  xml_path text, pdf_path text, obs text,
  status_receb text not null default 'pendente' check (status_receb in ('pendente','parcial','recebida','nao_aplica')),
  status_pgto text not null default 'pendente' check (status_pgto in ('pendente','parcial','pago','nao_aplica')),
  criado_em timestamptz default now(), criado_por uuid default auth.uid());

create table if not exists pp_nota_itens(
  id bigserial primary key, nota_id bigint not null references pp_notas(id) on delete cascade, n_item int not null,
  codigo text, ean text, descricao text, ncm text, cfop text, unidade text,
  qtd numeric not null, valor_unit numeric, valor_total numeric,
  desconto numeric default 0, frete numeric default 0, seguro numeric default 0, outras numeric default 0,
  ipi numeric default 0, icms_st numeric default 0, icms numeric default 0,
  bonificacao boolean not null default false, lote text, validade date,
  produto_id uuid references pp_produtos(id), fator numeric not null default 1,
  unique(nota_id,n_item));

create table if not exists pp_anexos(
  id bigserial primary key, entidade text not null, entidade_id text not null,
  nome text, caminho text not null, tipo text, criado_em timestamptz default now(), criado_por uuid default auth.uid());

-- Recebimento físico (separado da emissão e do pagamento)
create table if not exists pp_recebimentos(
  id bigserial primary key, nota_id bigint references pp_notas(id), local_id int references pp_locais(id),
  data date not null default current_date, responsavel uuid default auth.uid(), obs text, criado_em timestamptz default now());
create table if not exists pp_receb_itens(
  id bigserial primary key, recebimento_id bigint not null references pp_recebimentos(id) on delete cascade,
  nota_item_id bigint references pp_nota_itens(id), produto_id uuid references pp_produtos(id),
  qtd_recebida numeric not null default 0,    -- em unidades do cadastro mestre
  qtd_avariada numeric not null default 0, obs text);

-- ---------------------------------------------------------------------
-- 6. Estoque: razão de movimentações (sem custo) + custo separado
-- ---------------------------------------------------------------------
create table if not exists pp_mov(
  id bigserial primary key,
  produto_id uuid not null references pp_produtos(id), local_id int not null references pp_locais(id),
  data timestamptz not null default now(),
  tipo text not null check (tipo in ('saldo_inicial','compra','bonificacao','venda','devolucao_venda','devolucao_compra',
                                     'transferencia_saida','transferencia_entrada','perda','ajuste','consumo_interno')),
  qtd numeric not null,           -- positivo entra, negativo sai (unidades do cadastro mestre)
  origem text not null check (origem in ('simplesvet','ml','nf','manual','importacao')),
  origem_ref text not null,       -- chave única da origem → reimportar não duplica
  documento text, nota_id bigint references pp_notas(id), venda_id bigint, recebimento_id bigint references pp_recebimentos(id),
  responsavel text, obs text, criado_em timestamptz default now(), criado_por uuid default auth.uid(),
  unique(origem,origem_ref));
create index if not exists pp_mov_prod on pp_mov(produto_id,data);

create table if not exists pp_mov_custo(
  mov_id bigint primary key references pp_mov(id) on delete cascade,
  custo_unit numeric not null check (custo_unit>=0),
  confiavel boolean not null default true,   -- custo vindo do SimplesVet sem nota = false
  fonte text);

-- Histórico do custo médio ponderado (derivado; reconstruído por pp_recalcular_custo)
create table if not exists pp_custo_hist(
  id bigserial primary key, produto_id uuid not null references pp_produtos(id), data timestamptz not null,
  mov_id bigint references pp_mov(id) on delete cascade,
  qtd_entrada numeric, custo_entrada numeric, saldo_antes numeric, custo_medio_antes numeric,
  saldo_depois numeric, custo_medio_depois numeric, nota_id bigint);
create index if not exists pp_custo_hist_prod on pp_custo_hist(produto_id,data);

-- Saldos informados pelos sistemas de origem (para conferir divergência)
create table if not exists pp_saldos_externos(
  id bigserial primary key, fonte text not null, produto_id uuid references pp_produtos(id), local_id int references pp_locais(id),
  codigo text, data timestamptz not null, qtd numeric not null, unique(fonte,local_id,codigo,data));

-- ---------------------------------------------------------------------
-- 7. Vendas (loja e Mercado Livre)
-- ---------------------------------------------------------------------
create table if not exists pp_vendas(
  id bigserial primary key,
  canal text not null check (canal in ('loja','mercado_livre','outro')),
  empresa_id int references pp_empresas(id), unidade_id int references pp_unidades(id), ml_conta_id int references pp_ml_contas(id),
  origem text not null check (origem in ('simplesvet','ml','nf','manual','importacao')),
  origem_ref text not null, pedido text, pack_id text,
  data_venda timestamptz not null, status text not null default 'concluida'
    check (status in ('concluida','cancelada','devolvida','devolvida_parcial','pendente')),
  cliente text, logistica text,
  valor_bruto numeric not null default 0, desconto numeric not null default 0, valor_cancelado numeric not null default 0,
  valor_devolvido numeric not null default 0, frete_cobrado numeric not null default 0,
  tarifa_venda numeric not null default 0, frete_vendedor numeric not null default 0, outros_custos_var numeric not null default 0,
  valor_liquido_previsto numeric, data_pagamento date, data_liberacao date, liberado boolean,
  nota_id bigint references pp_notas(id),
  duplicada_de bigint references pp_vendas(id),   -- mesma venda registrada em outro sistema: não soma
  conciliada boolean not null default false, obs text,
  importado_em timestamptz default now(), unique(origem,origem_ref));
create index if not exists pp_vendas_data on pp_vendas(data_venda);

create table if not exists pp_venda_itens(
  id bigserial primary key, venda_id bigint not null references pp_vendas(id) on delete cascade, n int not null default 1,
  produto_id uuid references pp_produtos(id), codigo text, sku text, item_ml text, variacao_ml text, descricao text,
  qtd numeric not null, preco_unit numeric not null default 0, desconto numeric not null default 0,
  tarifa numeric not null default 0, eh_servico boolean not null default false, unique(venda_id,n));

-- custo congelado no momento da venda (compra nova não altera venda antiga)
create table if not exists pp_venda_itens_custo(
  item_id bigint primary key references pp_venda_itens(id) on delete cascade,
  custo_unit numeric, status text not null check (status in ('calculado','informado','ausente','servico')),
  calculado_em timestamptz default now(), revisao_sugerida numeric);

-- ---------------------------------------------------------------------
-- 8. Financeiro
-- ---------------------------------------------------------------------
create table if not exists pp_contas_fin(
  id serial primary key, empresa_id int references pp_empresas(id), nome text not null,
  tipo text not null check (tipo in ('banco','caixa','mercado_pago','cartao','outro')),
  saldo_inicial numeric, data_saldo_inicial date, ml_conta_id int references pp_ml_contas(id), ativa boolean not null default true);

create table if not exists pp_lancamentos(
  id bigserial primary key,
  tipo text not null check (tipo in ('pagar','receber','transferencia')),
  natureza text not null check (natureza in ('venda','fornecedor','despesa_fixa','despesa_variavel','imposto','folha',
     'aporte_socio','emprestimo_recebido','emprestimo_pago','retirada_socio','transferencia_interna','tarifa','outro')),
  empresa_id int references pp_empresas(id),           -- empresa dona da obrigação/receita
  empresa_assumiu_id int references pp_empresas(id),   -- quem efetivamente assumiu a despesa
  categoria text, descricao text not null, parceiro text,
  valor numeric not null check (valor>=0), competencia date, vencimento date,
  status text not null default 'aberto' check (status in ('aberto','pago','parcial','cancelado')),
  valor_pago numeric, data_pagamento date, conta_id int references pp_contas_fin(id), conta_destino_id int references pp_contas_fin(id),
  pago_por text, retido boolean not null default false,
  nota_id bigint references pp_notas(id), venda_id bigint references pp_vendas(id),
  origem text not null default 'manual', origem_ref text, obs text,
  criado_em timestamptz default now(), criado_por uuid default auth.uid());
drop index if exists pp_lanc_origem;
create unique index if not exists pp_lanc_origem_u on pp_lancamentos(origem,origem_ref);

-- ---------------------------------------------------------------------
-- 9. Integrações, importações, pendências e auditoria
-- ---------------------------------------------------------------------
create table if not exists pp_sync_log(
  id bigserial primary key, fonte text not null, conta text, tipo text,
  iniciado_em timestamptz default now(), terminado_em timestamptz,
  status text not null default 'rodando' check (status in ('rodando','ok','parcial','erro')),
  lidos int default 0, gravados int default 0, duplicados int default 0, erros int default 0,
  mensagem text, detalhes jsonb, usuario uuid default auth.uid());

create table if not exists pp_pendencias(
  id bigserial primary key,
  tipo text not null, -- venda_sem_nota, nota_sem_mov, receb_divergente, venda_sem_custo, sem_vinculo, qtd_divergente, duplicidade, cancel_nao_conciliado, unidade_divergente, produto_duplicado, custo_revisado, outro
  entidade text, entidade_id text, chave text unique,   -- chave evita abrir a mesma pendência duas vezes
  descricao text not null, valor numeric,
  responsavel uuid references pp_perfis(user_id),
  status text not null default 'aberta' check (status in ('aberta','em_analise','resolvida','ignorada')),
  obs text, criado_em timestamptz default now(), resolvido_em timestamptz);
create table if not exists pp_pendencia_hist(
  id bigserial primary key, pendencia_id bigint references pp_pendencias(id) on delete cascade,
  status text, obs text, usuario uuid default auth.uid(), em timestamptz default now());

create table if not exists pp_auditoria(
  id bigserial primary key, tabela text, operacao text, registro text, antes jsonb, depois jsonb,
  usuario uuid default auth.uid(), em timestamptz default now());

create or replace function pp_audit() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into pp_auditoria(tabela,operacao,registro,antes,depois)
  values (tg_table_name, tg_op,
          coalesce(case when tg_op='DELETE' then to_jsonb(old)->>'id' else to_jsonb(new)->>'id' end,
                   case when tg_op='DELETE' then to_jsonb(old)->>'chave' else to_jsonb(new)->>'chave' end),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new,old);
end $$;

do $$ declare t text; begin
  foreach t in array array['pp_perfis','pp_config','pp_produtos','pp_kit_itens','pp_codigos','pp_notas','pp_lancamentos',
                           'pp_contas_fin','pp_mov','pp_mov_custo','pp_venda_itens_custo','pp_ml_contas','pp_empresas','pp_locais'] loop
    execute format('drop trigger if exists %I on %I', t||'_audit', t);
    -- movimentações: audita só alterações/exclusões (inserções já têm origem e autor)
    if t in ('pp_mov','pp_mov_custo') then
      execute format('create trigger %I after update or delete on %I for each row execute function pp_audit()', t||'_audit', t);
    else
      execute format('create trigger %I after insert or update or delete on %I for each row execute function pp_audit()', t||'_audit', t);
    end if;
  end loop; end $$;

-- ---------------------------------------------------------------------
-- 10. Custo médio ponderado
-- ---------------------------------------------------------------------
-- Reconstrói o histórico de custo do produto a partir do razão (todas as unidades da empresa somadas).
-- Entradas com custo entram na média; bonificação vinculada entra a custo 0 (dilui o custo da compra);
-- saídas reduzem o saldo sem mudar a média.
create or replace function pp_recalcular_custo(p_produto uuid) returns void language plpgsql security definer set search_path=public as $$
declare r record; saldo numeric:=0; cm numeric:=null; novo numeric;
begin
  delete from pp_custo_hist where produto_id=p_produto;
  for r in select m.id,m.data,m.qtd,m.tipo,m.nota_id,c.custo_unit
           from pp_mov m join pp_locais l on l.id=m.local_id and l.tipo<>'espelho'
           left join pp_mov_custo c on c.mov_id=m.id
           where m.produto_id=p_produto and m.tipo not in ('transferencia_saida','transferencia_entrada')
           order by m.data,m.id loop
    if r.qtd>0 and r.custo_unit is not null then
      if saldo<=0 or cm is null then novo:=r.custo_unit;
      else novo:=(saldo*cm + r.qtd*r.custo_unit)/(saldo+r.qtd); end if;
      insert into pp_custo_hist(produto_id,data,mov_id,qtd_entrada,custo_entrada,saldo_antes,custo_medio_antes,saldo_depois,custo_medio_depois,nota_id)
      values (p_produto,r.data,r.id,r.qtd,r.custo_unit,saldo,cm,saldo+r.qtd,round(novo,6),r.nota_id);
      cm:=novo;
    end if;
    saldo:=saldo+r.qtd;
  end loop;
end $$;

create or replace function pp_custo_em(p_produto uuid, p_data timestamptz) returns numeric language plpgsql stable security definer set search_path=public as $$
declare v numeric; k record; tot numeric:=0; falta boolean:=false;
begin
  if exists(select 1 from pp_produtos where id=p_produto and eh_kit) then
    for k in select componente_id,qtd from pp_kit_itens where kit_id=p_produto loop
      v:=pp_custo_em(k.componente_id,p_data);
      if v is null then falta:=true; else tot:=tot+v*k.qtd; end if;
    end loop;
    return case when falta or tot=0 then null else tot end;
  end if;
  select custo_medio_depois into v from pp_custo_hist where produto_id=p_produto and data<=p_data order by data desc,id desc limit 1;
  return v;
end $$;

-- Qualquer movimento (entrada, saída, custo) muda a média seguinte: recalcula os produtos afetados (por comando)
create or replace function pp_mov_recalc_ins() returns trigger language plpgsql security definer set search_path=public as $$
declare p uuid; begin
  for p in select distinct produto_id from novos loop perform pp_recalcular_custo(p); end loop; return null; end $$;
create or replace function pp_mov_recalc_del() returns trigger language plpgsql security definer set search_path=public as $$
declare p uuid; begin
  for p in select distinct produto_id from velhos loop perform pp_recalcular_custo(p); end loop; return null; end $$;
create or replace function pp_movc_recalc_ins() returns trigger language plpgsql security definer set search_path=public as $$
declare p uuid; begin
  for p in select distinct m.produto_id from novos n join pp_mov m on m.id=n.mov_id loop perform pp_recalcular_custo(p); end loop; return null; end $$;
create or replace function pp_movc_recalc_del() returns trigger language plpgsql security definer set search_path=public as $$
declare p uuid; begin
  for p in select distinct m.produto_id from velhos n join pp_mov m on m.id=n.mov_id loop perform pp_recalcular_custo(p); end loop; return null; end $$;
drop trigger if exists pp_mov_custo_recalc on pp_mov_custo;
drop trigger if exists pp_movc_ins on pp_mov_custo; drop trigger if exists pp_movc_upd on pp_mov_custo; drop trigger if exists pp_movc_del on pp_mov_custo;
drop trigger if exists pp_mov_ins on pp_mov; drop trigger if exists pp_mov_del on pp_mov;
create trigger pp_mov_ins after insert on pp_mov referencing new table as novos for each statement execute function pp_mov_recalc_ins();
create trigger pp_mov_del after delete on pp_mov referencing old table as velhos for each statement execute function pp_mov_recalc_del();
create trigger pp_movc_ins after insert on pp_mov_custo referencing new table as novos for each statement execute function pp_movc_recalc_ins();
create trigger pp_movc_upd after update on pp_mov_custo referencing new table as novos for each statement execute function pp_movc_recalc_ins();
create trigger pp_movc_del after delete on pp_mov_custo referencing old table as velhos for each statement execute function pp_movc_recalc_del();

-- Congela o custo do item vendido. Se uma compra retroativa mudar o custo, NÃO altera:
-- registra revisao_sugerida e abre pendência.
create or replace function pp_congelar_custo(p_item bigint) returns void language plpgsql security definer set search_path=public as $$
declare i record; c numeric; atual pp_venda_itens_custo;
begin
  select vi.*, v.data_venda into i from pp_venda_itens vi join pp_vendas v on v.id=vi.venda_id where vi.id=p_item;
  if i is null then return; end if;
  select * into atual from pp_venda_itens_custo where item_id=p_item;
  if i.eh_servico then
    insert into pp_venda_itens_custo(item_id,custo_unit,status) values (p_item,null,'servico') on conflict (item_id) do nothing; return;
  end if;
  c:= case when i.produto_id is null then null else pp_custo_em(i.produto_id,i.data_venda) end;
  if atual.item_id is null or atual.status='ausente' then
    insert into pp_venda_itens_custo(item_id,custo_unit,status) values (p_item,c,case when c is null then 'ausente' else 'calculado' end)
    on conflict (item_id) do update set custo_unit=excluded.custo_unit,status=excluded.status,calculado_em=now();
  elsif atual.status='calculado' and c is not null and abs(c-atual.custo_unit)>0.005 then
    update pp_venda_itens_custo set revisao_sugerida=c where item_id=p_item;
    insert into pp_pendencias(tipo,entidade,entidade_id,chave,descricao,valor)
    values ('custo_revisado','venda_item',p_item::text,'custo_revisado:'||p_item,
            'Nova entrada retroativa mudaria o custo desta venda de '||round(atual.custo_unit,2)||' para '||round(c,2)||'. O resultado antigo foi mantido; revise.',
            round((c-atual.custo_unit)*i.qtd,2))
    on conflict (chave) do update set descricao=excluded.descricao,valor=excluded.valor,status='aberta';
  end if;
end $$;

create or replace function pp_venda_item_trg() returns trigger language plpgsql security definer set search_path=public as $$
begin perform pp_congelar_custo(new.id); return null; end $$;
drop trigger if exists pp_venda_item_custo on pp_venda_itens;
create trigger pp_venda_item_custo after insert or update of produto_id,eh_servico on pp_venda_itens for each row execute function pp_venda_item_trg();

-- Recalcula custos ausentes e sinaliza revisões (chamar após vincular SKUs ou importar notas)
create or replace function pp_reprocessar_custos_vendas(p_produto uuid default null) returns int language plpgsql security definer set search_path=public as $$
declare r record; n int:=0;
begin
  if not pp_ve_custo() then raise exception 'Sem permissão'; end if;
  for r in select vi.id from pp_venda_itens vi where (p_produto is null or vi.produto_id=p_produto) loop
    perform pp_congelar_custo(r.id); n:=n+1;
  end loop; return n;
end $$;

-- ---------------------------------------------------------------------
-- 11. Notas: lançar entrada no estoque a partir do recebimento
-- ---------------------------------------------------------------------
-- custo unitário de aquisição do item (em unidades do cadastro mestre), seguindo a configuração
create or replace function pp_custo_item_nota(p_item bigint) returns numeric language plpgsql stable security definer set search_path=public as $$
declare i pp_nota_itens; n pp_notas; tot numeric; base numeric; extra numeric:=0; soma_base numeric;
  inc_ipi boolean; inc_st boolean; inc_fr boolean; inc_out boolean; regra text;
begin
  if auth.uid() is not null and not pp_ve_custo() and not pp_tem('estoque') then return null; end if;
  select * into i from pp_nota_itens where id=p_item; select * into n from pp_notas where id=i.nota_id;
  if i.bonificacao or n.eh_bonificacao then return 0; end if;
  select (valor)::text::boolean into inc_ipi from pp_config where chave='custo_inclui_ipi';
  select (valor)::text::boolean into inc_st from pp_config where chave='custo_inclui_st';
  select (valor)::text::boolean into inc_fr from pp_config where chave='custo_inclui_frete';
  select (valor)::text::boolean into inc_out from pp_config where chave='custo_inclui_seguro_outras';
  select valor#>>'{}' into regra from pp_config where chave='rateio_frete';
  tot:=coalesce(i.valor_total,0)-coalesce(i.desconto,0)
       +case when inc_fr then coalesce(i.frete,0) else 0 end
       +case when inc_out then coalesce(i.seguro,0)+coalesce(i.outras,0) else 0 end
       +case when inc_ipi then coalesce(i.ipi,0) else 0 end
       +case when inc_st then coalesce(i.icms_st,0) else 0 end;
  if n.despesa_extra>0 and inc_fr then
    if regra='quantidade' then
      select sum(qtd*fator) into soma_base from pp_nota_itens where nota_id=n.id and not bonificacao;
      extra:=n.despesa_extra*(i.qtd*i.fator)/nullif(soma_base,0);
    else
      select sum(valor_total-coalesce(desconto,0)) into soma_base from pp_nota_itens where nota_id=n.id and not bonificacao;
      extra:=n.despesa_extra*(i.valor_total-coalesce(i.desconto,0))/nullif(soma_base,0);
    end if;
  end if;
  return round((tot+coalesce(extra,0))/nullif(i.qtd*i.fator,0),6);
end $$;

-- Registra um recebimento (total ou parcial). p_itens: [{"nota_item_id":1,"qtd":10,"avaria":0,"obs":""}] (qtd em unidades do cadastro)
create or replace function pp_receber_nota(p_nota bigint, p_local int, p_data date, p_itens jsonb, p_obs text default null)
returns bigint language plpgsql security definer set search_path=public as $$
declare rid bigint; x jsonb; it pp_nota_itens; n pp_notas; mid bigint; q numeric; c numeric; prev numeric; tot_prev numeric; tot_rec numeric;
begin
  if not pp_tem('compras','estoque') then raise exception 'Sem permissão para receber mercadoria'; end if;
  select * into n from pp_notas where id=p_nota;
  if n.tipo<>'entrada' then raise exception 'Somente notas de entrada'; end if;
  if not n.conferida then raise exception 'Nota lida por imagem ainda não conferida'; end if;
  insert into pp_recebimentos(nota_id,local_id,data,obs) values (p_nota,p_local,coalesce(p_data,current_date),p_obs) returning id into rid;
  for x in select * from jsonb_array_elements(p_itens) loop
    select * into it from pp_nota_itens where id=(x->>'nota_item_id')::bigint and nota_id=p_nota;
    if it.id is null then continue; end if;
    if it.produto_id is null then raise exception 'Item % (%) sem vínculo com o cadastro mestre', it.n_item, it.descricao; end if;
    q:=coalesce((x->>'qtd')::numeric,0);
    insert into pp_receb_itens(recebimento_id,nota_item_id,produto_id,qtd_recebida,qtd_avariada,obs)
    values (rid,it.id,it.produto_id,q,coalesce((x->>'avaria')::numeric,0),x->>'obs');
    if q>0 then
      insert into pp_mov(produto_id,local_id,data,tipo,qtd,origem,origem_ref,documento,nota_id,recebimento_id,responsavel)
      values (it.produto_id,p_local,(coalesce(p_data,current_date)::timestamp + interval '12 hours'),
              case when it.bonificacao or n.eh_bonificacao then 'bonificacao' else 'compra' end,
              q,'nf','receb:'||rid||':'||it.id,'NF '||n.numero||'/'||coalesce(n.serie,''),p_nota,rid,
              (select coalesce(nome,email) from pp_perfis where user_id=auth.uid()))
      returning id into mid;
      c:=pp_custo_item_nota(it.id);
      if n.eh_bonificacao and n.nota_relacionada_id is null then
        -- bonificação sem compra vinculada: entra a custo zero, mas fica pendente
        insert into pp_pendencias(tipo,entidade,entidade_id,chave,descricao)
        values ('outro','nota',p_nota::text,'bonif_sem_compra:'||p_nota,'Bonificação NF '||n.numero||' sem compra vinculada') on conflict do nothing;
      end if;
      if c is not null then insert into pp_mov_custo(mov_id,custo_unit,confiavel,fonte) values (mid,c,true,'NF '||n.numero); end if;
    end if;
  end loop;
  -- status do recebimento da nota
  select sum(qtd*fator) into tot_prev from pp_nota_itens where nota_id=p_nota;
  select sum(ri.qtd_recebida) into tot_rec from pp_receb_itens ri join pp_recebimentos r on r.id=ri.recebimento_id where r.nota_id=p_nota;
  update pp_notas set status_receb=case when coalesce(tot_rec,0)<=0 then 'pendente' when tot_rec<tot_prev then 'parcial' else 'recebida' end where id=p_nota;
  if tot_rec>tot_prev then
    insert into pp_pendencias(tipo,entidade,entidade_id,chave,descricao)
    values ('qtd_divergente','nota',p_nota::text,'receb_maior:'||p_nota,'Recebido mais do que a NF '||n.numero||' informa')
    on conflict (chave) do update set status='aberta';
  end if;
  return rid;
end $$;

-- Para o perfil Estoque: itens a receber SEM valores
create or replace function pp_itens_a_receber() returns table(nota_id bigint, numero text, fornecedor text, emissao timestamptz,
  nota_item_id bigint, descricao text, unidade text, produto_id uuid, produto text, qtd_prevista numeric, qtd_recebida numeric, lote text, validade date)
language sql stable security definer set search_path=public as $$
  select n.id,n.numero,n.parceiro_nome,n.emissao,i.id,i.descricao,i.unidade,i.produto_id,p.nome,i.qtd*i.fator,
         coalesce((select sum(ri.qtd_recebida) from pp_receb_itens ri where ri.nota_item_id=i.id),0), i.lote, i.validade
  from pp_notas n join pp_nota_itens i on i.nota_id=n.id left join pp_produtos p on p.id=i.produto_id
  where pp_tem('compras','estoque') and n.tipo='entrada' and n.status_receb in ('pendente','parcial') and n.situacao='autorizada'
  order by n.emissao, i.n_item
$$;

-- ---------------------------------------------------------------------
-- 12. Visões de estoque
-- ---------------------------------------------------------------------
create or replace view pp_v_saldos with (security_invoker=true) as
  select m.produto_id, m.local_id, l.empresa_id, l.tipo as tipo_local, sum(m.qtd) as saldo, max(m.data) as ultima_mov,
         min(m.data) filter (where m.tipo='saldo_inicial') as data_saldo_inicial
  from pp_mov m join pp_locais l on l.id=m.local_id group by 1,2,3,4;

-- ---------------------------------------------------------------------
-- 13. Gravação idempotente de vendas (usada pelo importador e pela sincronização)
-- p_venda: objeto da venda; p_itens: lista de itens. Retorna 'novo', 'atualizado' ou 'igual'.
-- ---------------------------------------------------------------------
create or replace function pp_gravar_venda(p_venda jsonb, p_itens jsonb) returns text language plpgsql security definer set search_path=public as $$
declare vid bigint; ant pp_vendas; x jsonb; k int:=0; pid uuid; res text;
begin
  if auth.uid() is not null and not pp_tem('financeiro','operacao') and not (p_venda->>'origem'='banho_tosa' and pp_tem('banho_tosa')) then raise exception 'Sem permissão'; end if;
  select * into ant from pp_vendas where origem=p_venda->>'origem' and origem_ref=p_venda->>'origem_ref';
  insert into pp_vendas(canal,empresa_id,unidade_id,ml_conta_id,origem,origem_ref,pedido,pack_id,data_venda,status,cliente,logistica,
     valor_bruto,desconto,valor_cancelado,valor_devolvido,frete_cobrado,tarifa_venda,frete_vendedor,outros_custos_var,
     valor_liquido_previsto,data_pagamento,data_liberacao,liberado)
  values (p_venda->>'canal',(p_venda->>'empresa_id')::int,(p_venda->>'unidade_id')::int,(p_venda->>'ml_conta_id')::int,
     p_venda->>'origem',p_venda->>'origem_ref',p_venda->>'pedido',p_venda->>'pack_id',(p_venda->>'data_venda')::timestamptz,
     coalesce(p_venda->>'status','concluida'),p_venda->>'cliente',p_venda->>'logistica',
     coalesce((p_venda->>'valor_bruto')::numeric,0),coalesce((p_venda->>'desconto')::numeric,0),coalesce((p_venda->>'valor_cancelado')::numeric,0),
     coalesce((p_venda->>'valor_devolvido')::numeric,0),coalesce((p_venda->>'frete_cobrado')::numeric,0),coalesce((p_venda->>'tarifa_venda')::numeric,0),
     coalesce((p_venda->>'frete_vendedor')::numeric,0),coalesce((p_venda->>'outros_custos_var')::numeric,0),
     (p_venda->>'valor_liquido_previsto')::numeric,(p_venda->>'data_pagamento')::date,(p_venda->>'data_liberacao')::date,(p_venda->>'liberado')::boolean)
  on conflict (origem,origem_ref) do update set status=excluded.status,valor_bruto=excluded.valor_bruto,desconto=excluded.desconto,
     valor_cancelado=excluded.valor_cancelado,valor_devolvido=excluded.valor_devolvido,frete_cobrado=excluded.frete_cobrado,
     tarifa_venda=excluded.tarifa_venda,frete_vendedor=excluded.frete_vendedor,outros_custos_var=excluded.outros_custos_var,
     valor_liquido_previsto=excluded.valor_liquido_previsto,data_pagamento=excluded.data_pagamento,data_liberacao=excluded.data_liberacao,
     liberado=excluded.liberado,cliente=coalesce(excluded.cliente,pp_vendas.cliente),logistica=coalesce(excluded.logistica,pp_vendas.logistica)
  returning id into vid;
  res:=case when ant.id is null then 'novo'
            when ant.status is distinct from coalesce(p_venda->>'status','concluida') or ant.valor_bruto is distinct from coalesce((p_venda->>'valor_bruto')::numeric,0)
                 or ant.data_liberacao is distinct from (p_venda->>'data_liberacao')::date or ant.liberado is distinct from (p_venda->>'liberado')::boolean then 'atualizado'
            else 'igual' end;
  for x in select * from jsonb_array_elements(coalesce(p_itens,'[]')) loop
    k:=k+1; pid:=null;
    -- vínculo pelo cadastro de códigos (somente confirmados)
    select produto_id into pid from pp_codigos where status='confirmado' and produto_id is not null and (
         (origem='ml_variacao' and codigo=x->>'variacao_ml' and coalesce(x->>'variacao_ml','')<>'')
      or (origem='ml_sku' and codigo=x->>'sku' and coalesce(x->>'sku','')<>'')
      or (origem='ml_item' and codigo=x->>'item_ml' and coalesce(x->>'item_ml','')<>'')
      or (origem='simplesvet' and codigo=x->>'codigo' and coalesce(x->>'codigo','')<>'')
      or (origem='ean' and codigo=x->>'ean' and coalesce(x->>'ean','')<>''))
      order by case origem when 'ml_variacao' then 1 when 'ml_sku' then 2 when 'ml_item' then 3 when 'simplesvet' then 4 else 5 end limit 1;
    insert into pp_venda_itens(venda_id,n,produto_id,codigo,sku,item_ml,variacao_ml,descricao,qtd,preco_unit,desconto,tarifa,eh_servico)
    values (vid,k,pid,x->>'codigo',x->>'sku',x->>'item_ml',x->>'variacao_ml',x->>'descricao',(x->>'qtd')::numeric,
            coalesce((x->>'preco_unit')::numeric,0),coalesce((x->>'desconto')::numeric,0),coalesce((x->>'tarifa')::numeric,0),
            coalesce((x->>'eh_servico')::boolean,false))
    on conflict (venda_id,n) do update set qtd=excluded.qtd,preco_unit=excluded.preco_unit,desconto=excluded.desconto,tarifa=excluded.tarifa,
       produto_id=coalesce(pp_venda_itens.produto_id,excluded.produto_id);
  end loop;
  return res;
end $$;

-- Vincula um código a um produto e aplica nos itens já importados
create or replace function pp_vincular_codigo(p_origem text, p_escopo text, p_codigo text, p_produto uuid, p_fator numeric default 1, p_descricao text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not pp_tem('compras','estoque','operacao','financeiro') then raise exception 'Sem permissão'; end if;
  insert into pp_codigos(produto_id,origem,escopo,codigo,descricao,fator,status,confirmado_por,confirmado_em)
  values (p_produto,p_origem,coalesce(p_escopo,''),p_codigo,p_descricao,coalesce(p_fator,1),'confirmado',auth.uid(),now())
  on conflict (origem,escopo,codigo) do update set produto_id=excluded.produto_id,fator=excluded.fator,status='confirmado',
     confirmado_por=auth.uid(),confirmado_em=now();
  if p_origem in ('ml_sku','ml_item','ml_variacao','simplesvet','ean') then
    update pp_venda_itens set produto_id=p_produto where produto_id is null and (
      (p_origem='ml_sku' and sku=p_codigo) or (p_origem='ml_item' and item_ml=p_codigo) or (p_origem='ml_variacao' and variacao_ml=p_codigo)
      or (p_origem='simplesvet' and codigo=p_codigo));
  end if;
  if p_origem='fornecedor' then
    update pp_nota_itens i set produto_id=p_produto, fator=coalesce(p_fator,1)
    from pp_notas n where n.id=i.nota_id and i.produto_id is null and i.codigo=p_codigo and n.parceiro_doc=p_escopo;
  end if;
  if p_origem='ean' then
    update pp_nota_itens set produto_id=p_produto where produto_id is null and ean=p_codigo;
  end if;
  update pp_pendencias set status='resolvida',resolvido_em=now() where chave='sem_vinculo:'||p_origem||':'||coalesce(p_escopo,'')||':'||p_codigo and status<>'resolvida';
end $$;

-- ---------------------------------------------------------------------
-- 14. Geração automática da central de divergências (idempotente)
-- ---------------------------------------------------------------------
create or replace function pp_gerar_pendencias() returns int language plpgsql security definer set search_path=public as $$
declare n int:=0; c int;
begin
  if not pp_logado() then raise exception 'Sem permissão'; end if;
  -- itens vendidos sem vínculo
  insert into pp_pendencias(tipo,entidade,entidade_id,chave,descricao,valor)
  select 'sem_vinculo','venda_item',min(vi.id)::text,
         'sem_vinculo:'||case when vi.variacao_ml is not null and vi.variacao_ml<>'' then 'ml_variacao::'||vi.variacao_ml
                              when vi.sku is not null and vi.sku<>'' then 'ml_sku::'||vi.sku
                              when vi.item_ml is not null then 'ml_item::'||vi.item_ml else 'simplesvet::'||coalesce(vi.codigo,vi.descricao) end,
         'Item vendido sem vínculo com o cadastro: '||max(vi.descricao)||' ('||count(*)||' vendas)', sum(vi.qtd*vi.preco_unit)
  from pp_venda_itens vi join pp_vendas v on v.id=vi.venda_id
  where vi.produto_id is null and not vi.eh_servico and v.duplicada_de is null
  group by 4 on conflict (chave) do update set descricao=excluded.descricao,valor=excluded.valor;
  get diagnostics c=row_count; n:=n+c;
  -- vendidos sem custo
  insert into pp_pendencias(tipo,entidade,entidade_id,chave,descricao,valor)
  select 'venda_sem_custo','produto',p.id::text,'venda_sem_custo:'||p.id,'Vendido sem custo confiável: '||p.nome||' ('||sum(vi.qtd)||' un.)',sum(vi.qtd*vi.preco_unit)
  from pp_venda_itens vi join pp_venda_itens_custo c on c.item_id=vi.id and c.status='ausente' join pp_produtos p on p.id=vi.produto_id
  join pp_vendas v on v.id=vi.venda_id and v.duplicada_de is null
  group by p.id,p.nome on conflict (chave) do update set descricao=excluded.descricao,valor=excluded.valor,
    status=case when pp_pendencias.status='resolvida' then 'aberta' else pp_pendencias.status end;
  get diagnostics c=row_count; n:=n+c;
  -- notas de entrada sem recebimento há mais de 7 dias
  insert into pp_pendencias(tipo,entidade,entidade_id,chave,descricao,valor)
  select 'nota_sem_mov','nota',id::text,'nota_sem_mov:'||id,'NF '||numero||' de '||coalesce(parceiro_nome,'?')||' sem recebimento lançado',valor_total
  from pp_notas where tipo='entrada' and situacao='autorizada' and status_receb='pendente' and emissao<now()-interval '7 days'
  on conflict (chave) do nothing;
  get diagnostics c=row_count; n:=n+c;
  -- vendas ML acima de R$ 0 sem nota
  insert into pp_pendencias(tipo,entidade,entidade_id,chave,descricao,valor)
  select 'venda_sem_nota','venda',id::text,'venda_sem_nota:'||id,'Pedido '||coalesce(pedido,origem_ref)||' sem nota fiscal vinculada',valor_bruto
  from pp_vendas where nota_id is null and canal='mercado_livre' and status='concluida' and duplicada_de is null and data_venda<now()-interval '3 days'
  on conflict (chave) do nothing;
  get diagnostics c=row_count; n:=n+c;
  -- cancelamentos/devoluções não conciliados
  insert into pp_pendencias(tipo,entidade,entidade_id,chave,descricao,valor)
  select 'cancel_nao_conciliado','venda',id::text,'cancel:'||id,'Pedido '||coalesce(pedido,origem_ref)||' '||status||' ainda não conciliado',valor_bruto
  from pp_vendas where status in ('cancelada','devolvida','devolvida_parcial') and not conciliada and duplicada_de is null
  on conflict (chave) do nothing;
  get diagnostics c=row_count; n:=n+c;
  -- recebimentos diferentes do previsto (ML liberado com valor diferente)
  insert into pp_pendencias(tipo,entidade,entidade_id,chave,descricao,valor)
  select 'receb_divergente','lancamento',l.id::text,'receb_div:'||l.id,'Recebido '||l.valor_pago||' x previsto '||l.valor||' — '||l.descricao,l.valor_pago-l.valor
  from pp_lancamentos l where l.tipo='receber' and l.status='pago' and l.valor_pago is not null and abs(l.valor_pago-l.valor)>0.05
  on conflict (chave) do nothing;
  get diagnostics c=row_count; n:=n+c;
  -- estoque negativo
  insert into pp_pendencias(tipo,entidade,entidade_id,chave,descricao,valor)
  select 'qtd_divergente','produto',s.produto_id::text,'neg:'||s.produto_id||':'||s.local_id,'Estoque negativo: '||p.nome||' em '||l.nome||' ('||s.saldo||')',null
  from pp_v_saldos s join pp_produtos p on p.id=s.produto_id join pp_locais l on l.id=s.local_id where s.saldo<0
  on conflict (chave) do update set status=case when pp_pendencias.status='resolvida' then 'aberta' else pp_pendencias.status end;
  get diagnostics c=row_count; n:=n+c;
  -- possíveis duplicidades: mesma data, mesmo valor, canais/origens diferentes, sem marcação
  insert into pp_pendencias(tipo,entidade,entidade_id,chave,descricao,valor)
  select 'duplicidade','venda',a.id::text,'dup:'||least(a.id,b.id)||':'||greatest(a.id,b.id),
         'Possível venda duplicada: '||a.origem||' '||coalesce(a.pedido,a.origem_ref)||' e '||b.origem||' '||coalesce(b.pedido,b.origem_ref),a.valor_bruto
  from pp_vendas a join pp_vendas b on a.id<b.id and a.origem<>b.origem and a.valor_bruto=b.valor_bruto and a.valor_bruto>0
       and abs(extract(epoch from a.data_venda-b.data_venda))<86400*2
  where a.duplicada_de is null and b.duplicada_de is null and a.data_venda>now()-interval '120 days'
  on conflict (chave) do nothing;
  get diagnostics c=row_count; n:=n+c;
  -- divergência de unidade: mesmo produto com fatores diferentes para o mesmo fornecedor+código não ocorre (unique); sinaliza unidade da NF ≠ cadastro com fator 1
  insert into pp_pendencias(tipo,entidade,entidade_id,chave,descricao)
  select 'unidade_divergente','nota_item',i.id::text,'un:'||i.id,'NF '||n.numero||': item "'||i.descricao||'" em '||i.unidade||' e cadastro em '||p.unidade||' com fator 1 — confira a conversão'
  from pp_nota_itens i join pp_notas n on n.id=i.nota_id join pp_produtos p on p.id=i.produto_id
  where i.fator=1 and upper(coalesce(i.unidade,'UN')) not in ('UN','UND','UNID','UNIDADE','PC','PÇ','PCT')
        and upper(coalesce(i.unidade,''))<>upper(p.unidade)
  on conflict (chave) do nothing;
  get diagnostics c=row_count; n:=n+c;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 15. RLS
-- ---------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['pp_perfis','pp_empresas','pp_unidades','pp_locais','pp_config','pp_produtos','pp_kit_itens','pp_codigos',
    'pp_ml_contas','pp_ml_tokens','pp_ml_anuncios','pp_notas','pp_nota_itens','pp_anexos','pp_recebimentos','pp_receb_itens','pp_mov','pp_mov_custo',
    'pp_custo_hist','pp_saldos_externos','pp_vendas','pp_venda_itens','pp_venda_itens_custo','pp_contas_fin','pp_lancamentos',
    'pp_sync_log','pp_pendencias','pp_pendencia_hist','pp_auditoria'] loop
    execute format('alter table %I enable row level security', t);
  end loop; end $$;

-- remove políticas antigas pp_ para recriar
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname='public' and tablename like 'pp\_%' loop
    execute format('drop policy %I on %I', r.policyname, r.tablename);
  end loop; end $$;

-- perfis: cada um vê o seu; master vê e altera todos
create policy pp_perfis_sel on pp_perfis for select using (user_id=auth.uid() or pp_master());
create policy pp_perfis_upd on pp_perfis for update using (pp_master()) with check (pp_master());
-- leitura geral para quem tem papel
create policy r on pp_empresas for select using (pp_logado());
create policy r on pp_unidades for select using (pp_logado());
create policy r on pp_locais for select using (pp_logado());
create policy r on pp_config for select using (pp_logado());
create policy r on pp_produtos for select using (pp_logado());
create policy r on pp_kit_itens for select using (pp_logado());
create policy r on pp_codigos for select using (pp_logado());
create policy r on pp_ml_contas for select using (pp_logado());
create policy r on pp_ml_anuncios for select using (pp_logado());
create policy r on pp_mov for select using (pp_logado());
create policy r on pp_saldos_externos for select using (pp_logado());
create policy r on pp_recebimentos for select using (pp_logado());
create policy r on pp_receb_itens for select using (pp_logado());
create policy r on pp_sync_log for select using (pp_logado());
create policy r on pp_vendas for select using (pp_tem('financeiro','operacao'));
create policy r on pp_venda_itens for select using (pp_tem('financeiro','operacao'));
create policy r on pp_pendencias for select using (pp_logado());
create policy r on pp_pendencia_hist for select using (pp_logado());
-- custos e notas (valores): master, financeiro, compras
create policy r on pp_mov_custo for select using (pp_ve_custo());
create policy r on pp_custo_hist for select using (pp_ve_custo());
create policy r on pp_venda_itens_custo for select using (pp_ve_custo());
create policy r on pp_notas for select using (pp_tem('financeiro','compras') or (tipo='saida' and pp_tem('operacao')));
create policy r on pp_nota_itens for select using (pp_ve_custo());
create policy r on pp_anexos for select using (pp_logado());
-- financeiro: master, financeiro
create policy r on pp_contas_fin for select using (pp_ve_fin());
create policy r on pp_lancamentos for select using (pp_ve_fin());
create policy r on pp_auditoria for select using (pp_master());
-- pp_ml_tokens: nenhuma política → só o servidor (service role) acessa

-- escrita
create policy w on pp_config for all using (pp_master()) with check (pp_master());
create policy w on pp_empresas for all using (pp_master()) with check (pp_master());
create policy w on pp_unidades for all using (pp_master()) with check (pp_master());
create policy w on pp_locais for all using (pp_master()) with check (pp_master());
create policy w on pp_ml_contas for all using (pp_master()) with check (pp_master());
create policy w on pp_produtos for all using (pp_tem('compras','estoque')) with check (pp_tem('compras','estoque'));
create policy w on pp_kit_itens for all using (pp_tem('compras','estoque')) with check (pp_tem('compras','estoque'));
create policy w on pp_codigos for all using (pp_tem('compras','estoque','operacao')) with check (pp_tem('compras','estoque','operacao'));
create policy w on pp_notas for all using (pp_tem('compras','financeiro')) with check (pp_tem('compras','financeiro'));
create policy w on pp_nota_itens for all using (pp_tem('compras','financeiro')) with check (pp_tem('compras','financeiro'));
create policy w on pp_anexos for insert with check (pp_logado());
create policy d on pp_anexos for delete using (pp_master() or criado_por=auth.uid());
create policy w on pp_mov for insert with check (pp_tem('estoque','compras') and origem in ('manual','importacao','simplesvet'));
create policy d on pp_mov for delete using (pp_master());
create policy w on pp_mov_custo for all using (pp_ve_custo()) with check (pp_ve_custo());
create policy w on pp_saldos_externos for all using (pp_tem('estoque','compras')) with check (pp_tem('estoque','compras'));
create policy w on pp_vendas for update using (pp_tem('financeiro','operacao')) with check (pp_tem('financeiro','operacao'));
create policy d on pp_vendas for delete using (pp_master());
create policy w on pp_venda_itens for update using (pp_tem('financeiro','operacao')) with check (pp_tem('financeiro','operacao'));
create policy w on pp_venda_itens_custo for update using (pp_ve_custo()) with check (pp_ve_custo());
create policy w on pp_contas_fin for all using (pp_ve_fin()) with check (pp_ve_fin());
create policy w on pp_lancamentos for all using (pp_ve_fin()) with check (pp_ve_fin());
create policy w on pp_pendencias for all using (pp_logado()) with check (pp_logado());
create policy w on pp_pendencia_hist for insert with check (pp_logado());
create policy w on pp_sync_log for all using (pp_logado()) with check (pp_logado());

-- funções: só usuários autenticados
-- funções internas: não podem ser chamadas pelo site (só por outras funções/gatilhos)
revoke all on function pp_recalcular_custo(uuid) from public, anon, authenticated;
revoke all on function pp_congelar_custo(bigint) from public, anon, authenticated;
revoke all on function pp_custo_em(uuid,timestamptz) from public, anon, authenticated;
revoke all on function pp_audit() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 16. Storage para XML, PDF e comprovantes (privado)
-- ---------------------------------------------------------------------
insert into storage.buckets(id,name,public) values ('pp-docs','pp-docs',false) on conflict (id) do nothing;
drop policy if exists pp_docs_sel on storage.objects;
drop policy if exists pp_docs_ins on storage.objects;
drop policy if exists pp_docs_del on storage.objects;
create policy pp_docs_sel on storage.objects for select using (bucket_id='pp-docs' and pp_logado());
create policy pp_docs_ins on storage.objects for insert with check (bucket_id='pp-docs' and pp_logado());
create policy pp_docs_del on storage.objects for delete using (bucket_id='pp-docs' and pp_master());

-- custo médio atual por produto (respeita RLS de pp_custo_hist)
create or replace view pp_v_custo_atual with (security_invoker=true) as
  select distinct on (produto_id) produto_id, custo_medio_depois as custo_medio, data as data_custo, custo_entrada as ultimo_custo_entrada, nota_id as ultima_nota_id
  from pp_custo_hist order by produto_id, data desc, id desc;

-- lotes e validades recebidos (sem valores) para todos os perfis
create or replace function pp_validades() returns table(produto_id uuid, lote text, validade date, qtd numeric, nota text, recebido date)
language sql stable security definer set search_path=public as $$
  select ri.produto_id, i.lote, i.validade, sum(ri.qtd_recebida), max(n.numero), max(r.data)
  from pp_receb_itens ri join pp_recebimentos r on r.id=ri.recebimento_id join pp_nota_itens i on i.id=ri.nota_item_id join pp_notas n on n.id=i.nota_id
  where pp_logado() and i.validade is not null group by 1,2,3
$$;

-- status de pagamento da nota acompanha as contas a pagar vinculadas
create or replace function pp_lanc_nota_trg() returns trigger language plpgsql security definer set search_path=public as $$
declare nid bigint:=coalesce(new.nota_id,old.nota_id); tot numeric; pago numeric; abertos int;
begin
  if nid is null then return null; end if;
  select sum(valor), sum(case when status='pago' then coalesce(valor_pago,valor) when status='parcial' then coalesce(valor_pago,0) else 0 end),
         count(*) filter (where status in ('aberto','parcial'))
    into tot,pago,abertos from pp_lancamentos where nota_id=nid and tipo='pagar' and status<>'cancelado';
  update pp_notas set status_pgto=case when tot is null then 'pendente' when abertos=0 then 'pago' when pago>0 then 'parcial' else 'pendente' end
   where id=nid and tipo='entrada';
  return null;
end $$;
drop trigger if exists pp_lanc_nota on pp_lancamentos;
create trigger pp_lanc_nota after insert or update or delete on pp_lancamentos for each row execute function pp_lanc_nota_trg();
