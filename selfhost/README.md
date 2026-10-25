# IRON · servidor próprio

Um servidor pequeno que sincroniza o IRON entre seus aparelhos, com login por passkey (sem senha). Os dados ficam em arquivos JSON numa pasta sua (`data/`). Roda com Docker Compose.

Ele é opcional. O app continua funcionando sozinho no aparelho e também com a conta na nuvem (Supabase). O servidor próprio é uma terceira opção, para quem quer tudo na própria máquina.

## O que você precisa

- Uma máquina ligada quase sempre (Raspberry Pi, mini PC, NAS, VPS) com Docker e Docker Compose.
- Um endereço https para o servidor. Passkey só funciona em https (ou em `localhost`). Opções simples: Caddy com um domínio seu, Cloudflare Tunnel, ou Tailscale (`tailscale serve` entrega https dentro da sua rede).

## Início rápido

1. Copie a pasta do projeto para o servidor e entre em `selfhost/`.
2. Crie a pasta de dados e o arquivo de configuração:

```
mkdir -p data
cp .env.example .env
```

3. Edite o `.env`: coloque em `ORIGINS` o endereço https pelo qual você vai abrir o app, e em `PUID`/`PGID` o resultado de `id -u` e `id -g` (assim a pasta `data/` fica sua).
4. Suba:

```
docker compose up -d --build
```

O servidor escuta em `127.0.0.1:8787`. Coloque um proxy https na frente (veja `Caddyfile.example`). No Nginx lembre de repassar o cabeçalho `Host`.

## Primeiro uso

1. Abra o endereço do servidor no celular (o próprio servidor entrega o app).
2. Conta (ícone no topo) -> Servidor próprio (passkey).
3. Escolha um nome de usuário e toque em Criar passkey. O aparelho pede biometria ou PIN.
4. Em outro aparelho: abra o app, Conta -> Servidor próprio, informe o endereço e toque em Entrar com passkey. Se a passkey estiver no seu gerenciador (iCloud, Google, 1Password), ela aparece sozinha.

Depois disso, treinos, cargas, programa, peso corporal e exercícios próprios sincronizam sozinhos. Desconectar um aparelho não apaga os treinos dele.

## Usar o app publicado no GitHub Pages com o seu servidor

Dá para abrir o app em `https://pablomtarga.github.io/iron-app/` e sincronizar com o seu servidor. Para isso, no `.env`:

```
ORIGINS=https://pablomtarga.github.io
```

e no app informe o endereço do servidor. A passkey nasce ligada ao endereço do site onde você abriu o app (aqui, `pablomtarga.github.io`). Se você criar a passkey por um endereço e depois abrir por outro, ela não vale no outro: crie uma nova ou use sempre o mesmo endereço.

## Variáveis (`.env`)

| Variável | Para que serve | Padrão |
|---|---|---|
| `ORIGINS` | Endereço(s) https do app, separados por vírgula. Vazio: só vale o app aberto pelo próprio servidor | vazio |
| `ALLOW_SIGNUP` | `false`: só o primeiro cadastro é aceito. `true`: qualquer pessoa cria usuário | `false` |
| `TOKEN_DAYS` | Dias que o aparelho fica logado | `90` |
| `PORT` | Porta no host | `8787` |
| `BIND` | Onde escuta no host. `127.0.0.1` só a própria máquina, `0.0.0.0` a rede toda | `127.0.0.1` |
| `PUID`, `PGID` | Usuário e grupo que rodam o container | `1000` |

## Seus dados e backup

Tudo fica em `selfhost/data/`:

- `users.json`: usuários e as chaves públicas das passkeys (nenhum segredo nem senha).
- `store/<usuário>.json`: os dados do app daquele usuário.
- `secret.key`: chave que assina as sessões. Se apagar, todos os aparelhos precisam entrar de novo.

Para fazer backup, copie a pasta `data/`. Para restaurar, coloque de volta e reinicie.

## Atualizar

```
git pull
docker compose up -d --build
```

## Como a segurança funciona

- Login por WebAuthn: o servidor guarda só a chave pública, nunca uma senha. Vazar o `users.json` não revela como entrar. Mesmo assim trate a pasta `data/` inteira como privada: nela estão seus treinos e o `secret.key` que assina as sessões.
- A sessão é um token assinado, com validade de `TOKEN_DAYS` dias, guardado no aparelho.
- Tentativas de login e cadastro têm limite por endereço.
- O servidor só aceita pedidos de passkey vindos dos endereços de `ORIGINS` (ou do próprio endereço dele, quando `ORIGINS` está vazio).
- Adicionar uma segunda passkey a um usuário existente exige estar logado nele.

## Limitações

- Pensado para uso pessoal ou de poucas pessoas. Não tem painel de administração nem recuperação de conta: se você perder todas as passkeys e o acesso ao `data/`, perde o acesso. Registre uma passkey em mais de um aparelho ou gerenciador.
- A sincronização junta o histórico de treinos e o peso corporal dos aparelhos. Para programa, cargas e configurações vale a versão mais recente enviada. Se dois aparelhos editarem o programa ao mesmo tempo, o último a sincronizar vence.
- Em rede local sem https o celular não deixa criar passkey. Use um dos caminhos de https acima.

## Rodando sem Docker

```
cd selfhost
npm install --omit=dev
PUBLIC_DIR=.. DATA_DIR=./data node server.js
```

Requer Node 20 ou mais novo.
