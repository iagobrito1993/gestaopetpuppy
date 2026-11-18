-- =====================================================================
-- GESTÃO PET PUPPY — migração 003: sincronização com o SimplesVet
-- Os dados vêm da API interna do SimplesVet lida com o login do usuário
-- (na própria aba do SimplesVet) e chegam aqui em lotes. Idempotente.
-- =====================================================================
alter table pp_vendas drop constraint if exists pp_vendas_origem_check;
alter table pp_vendas add constraint pp_vendas_origem_check check (origem in ('simplesvet','ml','nf','manual','importacao','banho_tosa'));

-- p: [{id, nome, ean, categoria, unidade, preco, custo, estoque, abertura}]
-- abertura = saldo reconstruído na data p_inicio (estoque atual + vendido desde então)
create or replace function pp_sv_produtos(p jsonb, p_local int, p_inicio timestamptz) returns jsonb language plpgsql security definer set search_path=public as $$
declare x jsonb; pid uuid; novos int:=0; atual int:=0; ini int:=0; mid bigint; cod text;
begin
  if not pp_tem('compras','estoque','financeiro') then raise exception 'Sem permissão'; end if;
  for x in select * from jsonb_array_elements(p) loop
    cod:=x->>'id';
    select produto_id into pid from pp_codigos where origem='simplesvet' and escopo='' and codigo=cod and status='confirmado';
    if pid is null then
      insert into pp_produtos(nome,categoria,ean,unidade) values (x->>'nome',nullif(x->>'categoria',''),nullif(x->>'ean',''),coalesce(nullif(upper(x->>'unidade'),''),'UN')) returning id into pid;
      insert into pp_codigos(produto_id,origem,escopo,codigo,descricao,status,confirmado_em) values (pid,'simplesvet','',cod,x->>'nome','confirmado',now())
        on conflict (origem,escopo,codigo) do update set produto_id=excluded.produto_id,status='confirmado';
      if coalesce(x->>'ean','')<>'' then
        insert into pp_codigos(produto_id,origem,escopo,codigo,descricao,status,confirmado_em) values (pid,'ean','',x->>'ean',x->>'nome','confirmado',now()) on conflict do nothing;
      end if;
      novos:=novos+1;
    else
      update pp_produtos set categoria=coalesce(categoria,nullif(x->>'categoria','')), ean=coalesce(ean,nullif(x->>'ean','')) where id=pid;
      atual:=atual+1;
    end if;
    insert into pp_saldos_externos(fonte,produto_id,local_id,codigo,data,qtd) values ('simplesvet',pid,p_local,cod,date_trunc('minute',now()),coalesce((x->>'estoque')::numeric,0))
      on conflict (fonte,local_id,codigo,data) do update set qtd=excluded.qtd;
    if not exists (select 1 from pp_mov where produto_id=pid and local_id=p_local and tipo='saldo_inicial') and coalesce((x->>'abertura')::numeric,0)<>0 then
      insert into pp_mov(produto_id,local_id,data,tipo,qtd,origem,origem_ref,documento,responsavel,obs)
      values (pid,p_local,p_inicio,'saldo_inicial',(x->>'abertura')::numeric,'simplesvet','svsi:'||p_local||':'||cod,'Saldo de abertura SimplesVet','Sincronização',
              'Reconstruído: estoque atual do SimplesVet + quantidades vendidas desde '||to_char(p_inicio,'DD/MM/YYYY'))
      on conflict (origem,origem_ref) do nothing returning id into mid;
      if mid is not null and coalesce((x->>'custo')::numeric,0)>0 then
        insert into pp_mov_custo(mov_id,custo_unit,confiavel,fonte) values (mid,(x->>'custo')::numeric,false,'Custo cadastrado no SimplesVet (sem nota)');
      end if;
      ini:=ini+1;
    end if;
  end loop;
  return jsonb_build_object('novos',novos,'existentes',atual,'saldos_iniciais',ini);
end $$;

-- v: [{id, data, status, bruto, desconto, devolvido, cliente, itens:[{n,codigo,descricao,qtd,preco_unit,desconto,servico}]}]
create or replace function pp_sv_vendas(v jsonb, p_local int) returns jsonb language plpgsql security definer set search_path=public as $$
declare x jsonb; i jsonb; emp int; uni int; r text; novos int:=0; upd int:=0; iguais int:=0; pid uuid; st text;
begin
  if not pp_tem('financeiro','operacao') then raise exception 'Sem permissão'; end if;
  select empresa_id,unidade_id into emp,uni from pp_locais where id=p_local;
  for x in select * from jsonb_array_elements(v) loop
    st:=case when x->>'status' in ('C','X','CA') then 'cancelada'
             when coalesce((x->>'devolvido')::numeric,0)>0 and (x->>'devolvido')::numeric>=(x->>'bruto')::numeric-coalesce((x->>'desconto')::numeric,0)-0.01 then 'devolvida'
             when coalesce((x->>'devolvido')::numeric,0)>0 then 'devolvida_parcial' else 'concluida' end;
    r:=pp_gravar_venda(jsonb_build_object('canal','loja','empresa_id',emp,'unidade_id',uni,'origem','simplesvet','origem_ref','sv:'||(x->>'id'),
        'pedido',x->>'id','data_venda',x->>'data','status',st,'cliente',x->>'cliente','valor_bruto',(x->>'bruto')::numeric,'desconto',coalesce((x->>'desconto')::numeric,0),
        'valor_cancelado',case when st='cancelada' then (x->>'bruto')::numeric else 0 end,'valor_devolvido',coalesce((x->>'devolvido')::numeric,0),
        'data_pagamento',case when x->>'status'='B' then substr(x->>'data',1,10) end), x->'itens');
    if r='novo' then novos:=novos+1; elsif r='atualizado' then upd:=upd+1; else iguais:=iguais+1; end if;
    -- baixa de estoque das mercadorias (não serviços), uma vez por item
    if st<>'cancelada' then
      for i in select * from jsonb_array_elements(x->'itens') loop
        if coalesce((i->>'servico')::boolean,false) then continue; end if;
        select produto_id into pid from pp_codigos where origem='simplesvet' and escopo='' and codigo=i->>'codigo' and status='confirmado';
        if pid is null then continue; end if;
        insert into pp_mov(produto_id,local_id,data,tipo,qtd,origem,origem_ref,documento,responsavel)
        values (pid,p_local,(x->>'data')::timestamptz,'venda',-abs((i->>'qtd')::numeric),'simplesvet','svv:'||(x->>'id')||':'||(i->>'n'),'Venda SimplesVet '||(x->>'id'),'SimplesVet')
        on conflict (origem,origem_ref) do nothing;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('novas',novos,'atualizadas',upd,'sem_alteracao',iguais);
end $$;

-- Iguala o saldo da loja ao SimplesVet (compras, perdas e ajustes feitos lá). a: [{codigo, estoque}]
create or replace function pp_sv_ajustar(a jsonb, p_local int, p_ref text) returns int language plpgsql security definer set search_path=public as $$
declare x jsonb; pid uuid; s numeric; d numeric; n int:=0;
begin
  if not pp_tem('compras','estoque','financeiro') then raise exception 'Sem permissão'; end if;
  for x in select * from jsonb_array_elements(a) loop
    select produto_id into pid from pp_codigos where origem='simplesvet' and escopo='' and codigo=x->>'codigo' and status='confirmado';
    if pid is null then continue; end if;
    select coalesce(sum(qtd),0) into s from pp_mov where produto_id=pid and local_id=p_local;
    d:=coalesce((x->>'estoque')::numeric,0)-s;
    if abs(d)>0.0001 then
      insert into pp_mov(produto_id,local_id,data,tipo,qtd,origem,origem_ref,documento,responsavel,obs)
      values (pid,p_local,now(),'ajuste',d,'simplesvet','svaj:'||p_ref||':'||(x->>'codigo'),'Ajuste para igualar ao SimplesVet','Sincronização',
              'Diferença entre o saldo do SimplesVet e o calculado (compras, perdas ou ajustes lançados lá)')
      on conflict (origem,origem_ref) do nothing;
      n:=n+1;
    end if;
  end loop;
  return n;
end $$;
