# Nostrabot (Audio Timer)

Projeto simples para enviar áudios, salvar no **Vercel Blob** e tocar um áudio aleatório após um timer.

## Pré-requisitos

- Node.js 20+ e npm
- Conta na Vercel
- Repositório conectado na Vercel (GitHub)

## Variáveis de ambiente

| Variável | Obrigatória | Uso |
| --- | --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Sim | Leitura/escrita no Vercel Blob |
| `NOSTRABOT_ADMIN_KEY` | Sim para upload/exclusão | Senha comparada com o header `x-admin-key`. Se estiver ausente, escritas são rejeitadas. |

Configure as duas em **Preview** e **Production** no projeto Vercel.

## Rodar local

1. Instale dependências:

   ```bash
   npm install
   ```

2. (Opcional) Puxe as variáveis do projeto Vercel:

   ```bash
   vercel env pull
   ```

3. Rode os testes:

   ```bash
   npm test
   ```

4. O site é estático (`public/`) com funções em `api/`. Para testar de ponta a ponta, use um deploy na Vercel (ou `vercel dev` se preferir).

## Deploy na Vercel

1. Crie/abra um projeto na Vercel e importe o repositório Git.
2. Vá em **Storage / Blob** e crie um **Blob store** com acesso **Public** (o upload usa `access: "public"`).
3. Defina `BLOB_READ_WRITE_TOKEN` e `NOSTRABOT_ADMIN_KEY` em Preview e Production.
4. Faça deploy (ou aguarde o deploy automático após o push no GitHub).
5. Ative **Web Analytics** no projeto (o HTML já inclui o script `/_vercel/insights/script.js`).

## API

### `GET /api/audio`

Lista arquivos sob o prefixo `audios/`. Resposta: `{ items: [...] }`.

### `DELETE /api/audio?url=<blobUrl>`

Remove o blob. Exige header `x-admin-key` igual a `NOSTRABOT_ADMIN_KEY`.

### `POST /api/upload`

Rota de token para upload direto do cliente (`handleUpload` do `@vercel/blob/client`):

- Exige `x-admin-key`
- `allowedContentTypes: ["audio/*"]`
- `maximumSizeInBytes`: 25 MB
- Pathname deve começar com `audios/`

O frontend envia o arquivo com `upload()` do `@vercel/blob/client`, sem passar o body pelo servidor.

## Frontend

- Módulos ES em `public/js/`
- Chave de admin pedida uma vez e salva em `localStorage` (botão **Alterar chave**)
- Tema claro/escuro, lista de áudios, timer fullscreen com peso ponderado
- Mensagens de erro em português (pt-BR) para listar / enviar / excluir

## CI

O workflow GitHub Actions em `.github/workflows/ci.yml` roda `npm ci` e `npm test` em push/PR.

## Supabase (Phase 2+)

Projeto: https://slkztbeihpesepamjcbo.supabase.co (chave publishable no frontend).

1. Aplique os arquivos em `supabase/migrations/` no SQL Editor.
2. Grave o hash da chave admin:

```sql
insert into private.app_config (key, value)
values (
  'admin_key_hash',
  encode(digest(convert_to('SUA_CHAVE', 'UTF8'), 'sha256'), 'hex')
)
on conflict (key) do update set value = excluded.value;
```

3. Use **Migrar Blob** na UI (uma vez) para trazer os audios antigos.
