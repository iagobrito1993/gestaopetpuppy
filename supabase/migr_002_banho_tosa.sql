-- =====================================================================
-- GESTÃO PET PUPPY — migração 002: Banho e Tosa + remoção da MJ Store
-- Idempotente.
-- =====================================================================

-- 1. Remove a MJ Store (sem dados ligados) ---------------------------------
delete from pp_ml_contas c where c.apelido='MJ Store'
  and not exists (select 1 from pp_vendas v where v.ml_conta_id=c.id);
delete from pp_locais l using pp_empresas e where l.empresa_id=e.id and e.nome='MJ Store'
  and not exists (select 1 from pp_mov m where m.local_id=l.id);
delete from pp_unidades u using pp_empresas e where u.empresa_id=e.id and e.nome='MJ Store'
  and not exists (select 1 from pp_locais l where l.unidade_id=u.id);
delete from pp_empresas e where e.nome='MJ Store'
  and not exists (select 1 from pp_unidades u where u.empresa_id=e.id)
  and not exists (select 1 from pp_vendas v where v.empresa_id=e.id)
  and not exists (select 1 from pp_notas n where n.empresa_id=e.id);

-- 2. Novo perfil: atendente de banho e tosa ----------------------------------
alter table pp_perfis drop constraint if exists pp_perfis_papel_check;
alter table pp_perfis add constraint pp_perfis_papel_check check (papel in ('master','financeiro','compras','estoque','operacao','banho_tosa'));
create or replace function pp_ve_bt() returns boolean language sql stable as $$ select pp_tem('operacao','banho_tosa','financeiro') $$;
create or replace function pp_edita_bt() returns boolean language sql stable as $$ select pp_tem('operacao','banho_tosa') $$;

-- vendas podem vir do banho e tosa
alter table pp_vendas drop constraint if exists pp_vendas_origem_check;
alter table pp_vendas add constraint pp_vendas_origem_check check (origem in ('simplesvet','ml','nf','manual','importacao','banho_tosa'));

insert into pp_config(chave,valor) values
 ('bt_gera_venda','true'),               -- atendimento entregue e pago vira venda no painel
 ('bt_frequencia_padrao','15'),          -- dias entre banhos quando o pet não tem frequência própria
 ('bt_horario_abre','"08:00"'),('bt_horario_fecha','"18:00"'),
 ('bt_msg_lembrete','"Olá {tutor}! Passando para lembrar do banho do(a) {pet} em {data} às {hora} aqui na Pet Puppy. Podemos confirmar? 🐶"'),
 ('bt_msg_pronto','"Olá {tutor}! O(a) {pet} já está prontinho(a) e cheiroso(a) esperando por você na Pet Puppy! 🛁✨"'),
 ('bt_msg_retorno','"Olá {tutor}! Já faz {dias} dias do último banho do(a) {pet}. Quer agendar o próximo? Temos horário em {data}. 🐾"')
on conflict (chave) do nothing;

-- 3. Tabelas -----------------------------------------------------------------
create table if not exists pp_tutores(
  id bigserial primary key, nome text not null, telefone text, email text, endereco text, obs text,
  ativo boolean not null default true, criado_em timestamptz default now(), criado_por uuid default auth.uid());
create table if not exists pp_pets(
  id bigserial primary key, tutor_id bigint not null references pp_tutores(id) on delete cascade,
  nome text not null, especie text not null default 'cao' check (especie in ('cao','gato','outro')),
  raca text, porte text not null default 'pequeno' check (porte in ('mini','pequeno','medio','grande','gigante')),
  pelagem text not null default 'curta' check (pelagem in ('curta','media','longa')),
  sexo text, nascimento date, peso numeric, temperamento text, cuidados text,
  frequencia_dias int, ativo boolean not null default true, criado_em timestamptz default now());
create table if not exists pp_bt_profissionais(id serial primary key, nome text not null, comissao_pct numeric not null default 0, ativo boolean not null default true);
create table if not exists pp_bt_servicos(
  id serial primary key, nome text not null, tipo text not null default 'banho' check (tipo in ('banho','tosa','hidratacao','adicional','transporte')),
  duracao_min int not null default 60, ativo boolean not null default true);
create table if not exists pp_bt_precos(
  servico_id int references pp_bt_servicos(id) on delete cascade, porte text not null, pelagem text not null default 'todas',
  preco numeric not null check (preco>=0), primary key(servico_id,porte,pelagem));
create table if not exists pp_bt_pacotes(
  id bigserial primary key, pet_id bigint not null references pp_pets(id) on delete cascade, servico_id int references pp_bt_servicos(id),
  descricao text, qtd_total int not null check (qtd_total>0), qtd_usada int not null default 0, valor numeric not null default 0,
  inicio date not null default current_date, validade date, pago boolean not null default false, venda_id bigint references pp_vendas(id),
  criado_em timestamptz default now());
create table if not exists pp_bt_agendamentos(
  id bigserial primary key, pet_id bigint not null references pp_pets(id) on delete cascade,
  data_hora timestamptz not null, duracao_min int not null default 60, profissional_id int references pp_bt_profissionais(id),
  status text not null default 'agendado' check (status in ('sugerido','agendado','confirmado','em_atendimento','pronto','entregue','faltou','cancelado')),
  origem text not null default 'manual' check (origem in ('manual','recorrencia','pacote')),
  leva_traz boolean not null default false, obs text, obs_atendimento text,
  valor_servicos numeric not null default 0, desconto numeric not null default 0, taxa_extra numeric not null default 0,
  forma_pagto text, pago boolean not null default false, pacote_id bigint references pp_bt_pacotes(id),
  lembrete_enviado_em timestamptz, aviso_pronto_em timestamptz,
  checkin_em timestamptz, pronto_em timestamptz, entregue_em timestamptz, venda_id bigint references pp_vendas(id),
  criado_por uuid default auth.uid(), criado_em timestamptz default now());
create index if not exists pp_bt_ag_data on pp_bt_agendamentos(data_hora);
create index if not exists pp_bt_ag_pet on pp_bt_agendamentos(pet_id,data_hora);
create table if not exists pp_bt_ag_servicos(
  agendamento_id bigint references pp_bt_agendamentos(id) on delete cascade, servico_id int references pp_bt_servicos(id),
  preco numeric not null default 0, pelo_pacote boolean not null default false, primary key(agendamento_id,servico_id));

-- serviços e preços iniciais (editáveis na tela)
insert into pp_bt_servicos(nome,tipo,duracao_min) select * from (values ('Banho','banho',60),('Banho e tosa higiênica','banho',75),('Banho e tosa completa','tosa',120),
  ('Hidratação','hidratacao',20),('Corte de unhas','adicional',10),('Leva e traz','transporte',0)) v(n,t,d)
  where not exists (select 1 from pp_bt_servicos);

-- 4. Automação ---------------------------------------------------------------
-- Total do atendimento a partir dos serviços (pacote zera o serviço coberto)
create or replace function pp_bt_recalc(p_ag bigint) returns void language sql security definer set search_path=public as $$
  update pp_bt_agendamentos a set valor_servicos=coalesce((select sum(case when pelo_pacote then 0 else preco end) from pp_bt_ag_servicos where agendamento_id=a.id),0) where a.id=p_ag;
$$;
create or replace function pp_bt_ags_trg() returns trigger language plpgsql security definer set search_path=public as $$
begin perform pp_bt_recalc(coalesce(new.agendamento_id,old.agendamento_id)); return null; end $$;
drop trigger if exists pp_bt_ags_recalc on pp_bt_ag_servicos;
create trigger pp_bt_ags_recalc after insert or update or delete on pp_bt_ag_servicos for each row execute function pp_bt_ags_trg();

-- Ao mudar de status: carimba horários; ao entregar, baixa pacote, gera venda (se pago) e agenda o próximo retorno
create or replace function pp_bt_status_trg() returns trigger language plpgsql security definer set search_path=public as $$
declare p pp_pets; t pp_tutores; freq int; emp int; itens jsonb; prox timestamptz;
begin
  if new.status is distinct from old.status then
    if new.status='em_atendimento' and new.checkin_em is null then new.checkin_em:=now(); end if;
    if new.status='pronto' and new.pronto_em is null then new.pronto_em:=now(); end if;
    if new.status='entregue' and new.entregue_em is null then new.entregue_em:=now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists pp_bt_status on pp_bt_agendamentos;
create trigger pp_bt_status before update on pp_bt_agendamentos for each row execute function pp_bt_status_trg();

create or replace function pp_bt_pos_trg() returns trigger language plpgsql security definer set search_path=public as $$
declare p pp_pets; t pp_tutores; freq int; emp int; itens jsonb; prox timestamptz; total numeric;
begin
  if new.status='entregue' and (old.status is distinct from 'entregue') then
    -- baixa do pacote
    if new.pacote_id is not null then update pp_bt_pacotes set qtd_usada=qtd_usada+1 where id=new.pacote_id; end if;
    -- próximo retorno automático (sugerido), se não houver outro futuro
    select * into p from pp_pets where id=new.pet_id;
    freq:=coalesce(p.frequencia_dias,(select (valor#>>'{}')::int from pp_config where chave='bt_frequencia_padrao'));
    if freq>0 and not exists (select 1 from pp_bt_agendamentos where pet_id=new.pet_id and data_hora>now() and status not in ('cancelado','faltou')) then
      prox:=new.data_hora+(freq||' days')::interval;
      insert into pp_bt_agendamentos(pet_id,data_hora,duracao_min,profissional_id,status,origem,leva_traz,pacote_id)
      values (new.pet_id,prox,new.duracao_min,new.profissional_id,'sugerido','recorrencia',new.leva_traz,
              (select id from pp_bt_pacotes where id=new.pacote_id and qtd_usada<qtd_total and (validade is null or validade>=prox::date)));
      insert into pp_bt_ag_servicos(agendamento_id,servico_id,preco,pelo_pacote)
      select currval('pp_bt_agendamentos_id_seq'),servico_id,preco,pelo_pacote and exists(select 1 from pp_bt_pacotes where id=new.pacote_id and qtd_usada<qtd_total)
      from pp_bt_ag_servicos where agendamento_id=new.id;
    end if;
  end if;
  -- gera a venda quando entregue e pago (uma vez só)
  if new.status='entregue' and new.pago and new.venda_id is null and coalesce((select (valor)::text::boolean from pp_config where chave='bt_gera_venda'),true) then
    total:=new.valor_servicos-new.desconto+new.taxa_extra;
    select * into p from pp_pets where id=new.pet_id; select * into t from pp_tutores where id=p.tutor_id;
    select id into emp from pp_empresas where cnpj='15176325000105';
    select coalesce(jsonb_agg(jsonb_build_object('codigo','BT-'||s.id,'descricao',s.nome||' — '||p.nome,'qtd',1,'preco_unit',case when x.pelo_pacote then 0 else x.preco end,'eh_servico',true)),'[]')
      into itens from pp_bt_ag_servicos x join pp_bt_servicos s on s.id=x.servico_id where x.agendamento_id=new.id;
    if new.taxa_extra>0 then itens:=itens||jsonb_build_array(jsonb_build_object('codigo','BT-EXTRA','descricao','Taxa extra','qtd',1,'preco_unit',new.taxa_extra,'eh_servico',true)); end if;
    perform pp_gravar_venda(jsonb_build_object('canal','loja','empresa_id',emp,'unidade_id',(select id from pp_unidades where empresa_id=emp limit 1),'origem','banho_tosa',
       'origem_ref','bt:'||new.id,'pedido','BT-'||new.id,'data_venda',coalesce(new.entregue_em,now()),'status','concluida','cliente',t.nome,
       'valor_bruto',new.valor_servicos+new.taxa_extra,'desconto',new.desconto,'data_pagamento',current_date),itens);
    update pp_bt_agendamentos set venda_id=(select id from pp_vendas where origem='banho_tosa' and origem_ref='bt:'||new.id) where id=new.id;
  end if;
  return null;
end $$;
drop trigger if exists pp_bt_pos on pp_bt_agendamentos;
create trigger pp_bt_pos after update of status,pago on pp_bt_agendamentos for each row execute function pp_bt_pos_trg();

-- Gera retornos sugeridos para pets ativos sem próximo agendamento (botão "Gerar retornos")
create or replace function pp_bt_gerar_retornos() returns int language plpgsql security definer set search_path=public as $$
declare r record; n int:=0; padrao int:=(select (valor#>>'{}')::int from pp_config where chave='bt_frequencia_padrao');
begin
  if not pp_edita_bt() then raise exception 'Sem permissão'; end if;
  for r in select p.id, coalesce(p.frequencia_dias,padrao) freq, u.data_hora, u.duracao_min, u.profissional_id, u.id ult
           from pp_pets p join lateral (select * from pp_bt_agendamentos a where a.pet_id=p.id and a.status='entregue' order by data_hora desc limit 1) u on true
           where p.ativo and coalesce(p.frequencia_dias,padrao)>0
             and not exists (select 1 from pp_bt_agendamentos f where f.pet_id=p.id and f.data_hora>now() and f.status not in ('cancelado','faltou')) loop
    insert into pp_bt_agendamentos(pet_id,data_hora,duracao_min,profissional_id,status,origem)
    values (r.id, greatest(r.data_hora+(r.freq||' days')::interval, date_trunc('day',now())+interval '1 day'+(extract(hour from r.data_hora)||' hours')::interval), r.duracao_min, r.profissional_id,'sugerido','recorrencia');
    insert into pp_bt_ag_servicos(agendamento_id,servico_id,preco) select currval('pp_bt_agendamentos_id_seq'),servico_id,preco from pp_bt_ag_servicos where agendamento_id=r.ult;
    n:=n+1;
  end loop;
  return n;
end $$;

-- 5. RLS ---------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['pp_tutores','pp_pets','pp_bt_profissionais','pp_bt_servicos','pp_bt_precos','pp_bt_pacotes','pp_bt_agendamentos','pp_bt_ag_servicos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists r on %I', t); execute format('drop policy if exists w on %I', t);
    execute format('create policy r on %I for select using (pp_ve_bt())', t);
    execute format('create policy w on %I for all using (pp_edita_bt()) with check (pp_edita_bt())', t);
    execute format('drop trigger if exists %I on %I', t||'_audit', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function pp_audit()', t||'_audit', t);
  end loop; end $$;
-- preços e serviços: só master altera
drop policy if exists w on pp_bt_servicos; create policy w on pp_bt_servicos for all using (pp_master()) with check (pp_master());
drop policy if exists w on pp_bt_precos; create policy w on pp_bt_precos for all using (pp_master()) with check (pp_master());
drop policy if exists w on pp_bt_profissionais; create policy w on pp_bt_profissionais for all using (pp_master()) with check (pp_master());
-- atendente de banho e tosa também precisa ler o básico
drop policy if exists r on pp_empresas; create policy r on pp_empresas for select using (pp_logado());
