-- =====================================================================
-- GESTÃO PET PUPPY — migração 005: perfil "Sócio 01"
-- Vê e opera tudo como o master, EXCETO: gerenciar usuários (pp_perfis),
-- ver a auditoria e as ações exclusivas do master (pp_master()).
-- =====================================================================
alter table pp_perfis drop constraint if exists pp_perfis_papel_check;
alter table pp_perfis add constraint pp_perfis_papel_check
  check (papel in ('master','socio','financeiro','compras','estoque','operacao','banho_tosa'));

-- pp_tem passa a liberar o sócio em todas as áreas; pp_master() continua só do master
create or replace function pp_tem(variadic papeis text[]) returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(pp_papel() = any(papeis) or pp_papel() in ('master','socio'),false)
$$;
