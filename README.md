# Gestão Pet Puppy

Painel de gestão da operação pet (Pet Puppy · LH Vezoni e MJ Store): vendas da loja (SimplesVet) e do Mercado Livre, notas fiscais de entrada e saída, cadastro mestre de produtos e SKUs, estoque com rastreabilidade, custo médio ponderado, margens, financeiro, fluxo de caixa e conciliação.

Endereço: https://gestaopetpuppy.com.br (GitHub Pages) · Banco: Supabase (projeto da Tudo Mix, tabelas `pp_*` isoladas por RLS).

## Estrutura
- `index.html` + `js/*.js` — site (estático, sem build).
- `supabase/schema.sql` — banco: tabelas, regras de permissão (RLS), custo médio, recebimentos, conciliação. Idempotente.
- `supabase/functions/pp-ml/index.ts` — integração Mercado Livre/Mercado Pago (somente leitura).

## Regras principais
- Emissão da nota, recebimento da mercadoria e pagamento são eventos separados.
- Custo médio ponderado reconstruído a partir do razão de movimentações; custo da venda é congelado na data da venda. Compra retroativa não altera vendas antigas: abre pendência "custo revisado".
- Bonificação vinculada entra a custo zero (dilui o custo da compra). Sem custo confiável = "sem custo", nunca zero.
- Reimportação/ressincronização não duplica (chave única `origem + origem_ref` em vendas, movimentações e lançamentos; chave de acesso única nas notas).
- Venda registrada em dois sistemas: marque `duplicada_de` — o registro fica vinculado e não soma.
- Estoque "espelho" (mesmas unidades vistas em outro sistema) não soma.
- Permissões aplicadas no banco: master, financeiro, compras, estoque, operação.

## Pendências externas
- Registro do domínio (titular: CPF do Iago) no Registro.br.
- App do Mercado Livre (developers.mercadolivre.com.br) → App ID/Secret nos segredos da função `pp-ml`.
- SimplesVet: sem API pública → importação de CSV/Excel com conferência.
