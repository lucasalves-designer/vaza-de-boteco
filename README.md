# Vaza de Boteco

Jogo de cartas por vazas, 2 a 4 jogadores, online. Node + Express + Socket.IO no servidor; HTML, CSS e JavaScript puros no navegador. Não há arquivos de áudio nem de imagem: a música e os efeitos são sintetizados pelo navegador.

## Rodar

```bash
npm install
npm start          # http://localhost:3000
npm test           # partida completa com 2 humanos + 2 bots, salas, chat
```

Requer Node 18 ou mais novo. Abra **sempre pelo endereço do servidor** (`http://localhost:3000`), não o `index.html` direto.

Na mesma rede Wi-Fi, os amigos entram em `http://IP-DO-SEU-COMPUTADOR:3000`. Pela internet, publique em uma hospedagem que aceite WebSocket (Render, Railway, Fly.io). O comando de início é `npm start` e a porta vem da variável `PORT`.

## Como se joga

- Cada jogador começa com **5 cartas**, e cada carta é uma "vida".
- Baralho de 40 cartas: 4 5 6 7 Q J K A 2 3. Naipes do menor para o maior: ♦ ♠ ♥ ♣.
- A **vira** define a **manilha** (o valor seguinte). Manilhas ganham de tudo; entre manilhas, vale o naipe.
- No começo da rodada cada jogador recebe uma **habilidade aleatória**, com uma animação de sorteio. Depois todos apostam quantas vazas vão fazer.
- Quem está à esquerda do carteador abre a primeira vaza; quem ganha a vaza abre a próxima.
- O último a apostar não pode fechar a soma exatamente igual ao total de vazas da rodada.
- **Errou a aposta?** Perde tantas cartas quanto foi o erro (apostou 2 e fez 0: perde 2). Acertou: não perde nada.
- Com 0 cartas o jogador está eliminado. A partida termina quando sobra um.
- Habilidades (uso único, na sua vez): Mão Boa, Carta Marcada, Ás na Manga, Pé Frio, Saideira, Cerveja Gelada (+1 carta, até 5).

## Salas e chat

- A tela inicial lista as salas públicas em tempo real, com anfitrião, vagas e estado (aguardando ou em jogo).
- Criar sala: nome, 2 a 4 jogadores, pública ou privada. Salas privadas não aparecem na lista; entra-se pelo código ou pelo link `?sala=CODIGO`.
- O chat é por sala (lobby e partida), com mensagens rápidas, aba de registro da partida e aviso de mensagens novas. Limite de 200 caracteres e uma mensagem a cada meio segundo.
- Quem sai no meio da partida é substituído por um bot. Quem demora mais de 40 segundos joga no automático.

## Ajustes no código

Constantes no topo de `server.js`:

| Constante | Padrão | O que faz |
|---|---|---|
| `MAXC` | 5 | cartas iniciais e máximo |
| `TURN_MS` | 40000 | tempo por jogada antes do automático |
| `REVEAL` | true | `false` esconde a habilidade dos outros jogadores no sorteio |

## Estrutura

```
server.js          servidor autoritativo: salas, regras, bots, chat
public/index.html  telas
public/css/        visual
public/js/app.js   cliente (desenha o estado e envia intenções)
public/js/audio.js música (baião em sol maior) e efeitos
tests/smoke.js     teste de ponta a ponta
```

## Limitações conhecidas

- Salas ficam em memória: reiniciar o servidor apaga tudo.
- Não há reconexão: quem cai perde o lugar (um bot assume).
- Sem contas, sem limite de requisições por IP e sem anti-fraude além da validação no servidor. Revise isso antes de abrir ao público.
- Moedas e relíquias do manual original não foram implementadas.
- As fontes (Bungee e Chakra Petch) vêm do Google Fonts; sem internet o jogo usa fontes do sistema.
