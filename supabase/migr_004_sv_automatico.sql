-- =====================================================================
-- GESTÃO PET PUPPY — migração 004: sincronização automática do SimplesVet
-- A aba do SimplesVet grava direto aqui com uma chave de sincronização
-- (guardada só no navegador do dono). A chave só libera as funções de sync.
-- =====================================================================
create table if not exists pp_sv_chaves(
  id serial primary key, hash text unique not null, descricao text,
  ativa boolean not null default true, criado_em timestamptz default now(), usado_em timestamptz);
alter table pp_sv_chaves enable row level security;
drop policy if exists r on pp_sv_chaves;
create policy r on pp_sv_chaves for select using (pp_master());

-- Durante uma chamada com chave válida, a transação age como "master" só para as funções de sync.
create or replace function pp_papel() returns text language sql stable security definer set search_path=public as $$
  select case when current_setting('pp.sync_auto', true) = '1' then 'master'
              else (select papel from pp_perfis where user_id=auth.uid() and ativo) end
$$;

create or replace function pp_sv_auto(p_chave text, p_tipo text, p_dados jsonb default null, p_inicio timestamptz default null, p_ref text default null, p_log bigint default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare loc int; lid bigint; r jsonb; n int;
begin
  update pp_sv_chaves set usado_em=now() where ativa and hash=encode(sha256(convert_to(coalesce(p_chave,''),'UTF8')),'hex');
  if not found then raise exception 'Chave de sincronização inválida'; end if;
  perform set_config('pp.sync_auto','1',true);
  select id into loc from pp_locais where tipo='loja' order by id limit 1;
  if loc is null then select id into loc from pp_locais order by id limit 1; end if;
  if p_tipo='inicio' then
    insert into pp_sync_log(fonte,tipo,conta,status,lidos) values ('simplesvet','produtos,vendas,estoque (automático)','Loja','rodando',coalesce((p_dados->>'lidos')::int,0)) returning id into lid;
    return jsonb_build_object('log',lid);
  elsif p_tipo='produtos' then return pp_sv_produtos(p_dados, loc, p_inicio);
  elsif p_tipo='vendas' then return pp_sv_vendas(p_dados, loc);
  elsif p_tipo='ajustar' then n:=pp_sv_ajustar(p_dados, loc, p_ref); return jsonb_build_object('ajustes',n);
  elsif p_tipo='fim' then
    begin perform pp_gerar_pendencias(); exception when others then null; end;
    update pp_sync_log set status=coalesce(p_dados->>'status','ok'), terminado_em=now(),
      gravados=coalesce((p_dados->>'gravados')::int,0), duplicados=coalesce((p_dados->>'duplicados')::int,0),
      erros=coalesce((p_dados->>'erros')::int,0), mensagem=p_dados->>'mensagem', detalhes=p_dados->'detalhes'
    where id=p_log and fonte='simplesvet';
    return jsonb_build_object('ok',true);
  end if;
  raise exception 'Tipo desconhecido: %', p_tipo;
end $$;
revoke all on function pp_sv_auto(text,text,jsonb,timestamptz,text,bigint) from public;
grant execute on function pp_sv_auto(text,text,jsonb,timestamptz,text,bigint) to anon, authenticated;
