// chatbot_pizzaria_fluxo_automatico.js - BOT Pizzaria Di Casa (Final completo corrigido + IA)
require('dotenv').config();

const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');
const { interpretarMensagem } = require('./ia'); // IA integrada aqui

// ===== CONFIG =====
const PIX_INFO = {
  chave: '99991056556',
  nome: 'FRANCISCO ARAUJO MESQUITA',
  banco: 'MERCADO PAGO'
};
const GRUPO_PEDIDOS = null;

const DIR_COMPROVANTES = path.resolve(__dirname, 'comprovantes');
if (!fs.existsSync(DIR_COMPROVANTES)) fs.mkdirSync(DIR_COMPROVANTES);

const modoSimulacao = process.argv.includes('--simular');

// Cardápio
const CARDAPIO = {
  P: 25,
  G: 45,
  F: 55,
  Borda: 5,
  Sabores: ['Calabresa','Frango/Catupiry','Portuguesa','Quatro Queijos']
};

// Nova configuração de taxas de entrega por bairro
const TAXAS_ENTREGA = {
  'nova açailândia 2': 8.50,
  'nova açailândia': 8.00,
  'centro': 5.00,
  'bom jardim': 9.00,
  'vila nova': 6.00, // Adicionado para a lógica
  // Adicione outros bairros e suas taxas aqui
  'padrao': 8.00 // Taxa padrão para bairros não listados
};

const pedidosEmAndamento = new Map();
const etapas = ['nome', 'endereco', 'bairro', 'pagamento'];
const exemplosEtapas = {
  nome: "📌 Exemplo: João da Silva",
  endereco: "📌 Exemplo: Rua das Flores, nº 123, apto 45",
  bairro: "📌 Exemplo: Centro",
  pagamento: "📌 Exemplo: PIX ou Dinheiro"
};

// === Funções Utilitárias ===
const esperar = ms => new Promise(res => setTimeout(res, ms));

const enviar = async (destino, texto) => {
  const rodape = "\n\nℹ️ Digite 0 para voltar ao menu inicial ou 99 para voltar à pergunta anterior.";
  if (!texto.includes('ℹ️ Digite 0')) {
    texto += rodape;
  }

  if (modoSimulacao) {
    console.log(`[${destino}] ... digitando`);
    await esperar(Math.min(2000 + texto.length * 10, 5000));
    console.log(`\n[Para ${destino}]\n${texto}\n`);
  } else {
    const chat = await client.getChatById(destino);
    await chat.sendStateTyping();
    await esperar(Math.min(2000 + texto.length * 10, 5000));
    await client.sendMessage(destino, texto);
  }
};

function normalizarNumeros(txt) {
  const mapa = {
    'um':'1','uma':'1','dois':'2','duas':'2','três':'3','tres':'3',
    'quatro':'4','cinco':'5','seis':'6','sete':'7','oito':'8','nove':'9'
  };
  return txt.replace(/\b(um|uma|dois|duas|tr[êe]s|quatro|cinco|seis|sete|oito|nove)\b/gi, m => mapa[m.toLowerCase()]);
}

function parsePedido(txt) {
  txt = normalizarNumeros(txt)
    .replace(/\bpequena\b/gi, 'P')
    .replace(/\bgrande\b/gi, 'G')
    .replace(/\bfam(í|i)lia\b/gi, 'F');

  const pedidos = [];
  const regex = /(\d+)\s*(?:pizza[s]?)?\s*(P|G|F)\s*([^0-9]+)/gi;
  let m;
  while ((m = regex.exec(txt)) !== null) {
    const qtd = parseInt(m[1]);
    const tamanho = m[2].toUpperCase();
    let desc = m[3] || '';
    const temBorda = /borda/i.test(desc);
    desc = desc.replace(/com\s*borda/ig, '');
    const sabores = desc.split(/\/|,| e | metade /i).map(s => s.trim()).filter(Boolean);
    pedidos.push({ qtd, tamanho, sabores, borda: temBorda });
  }
  return pedidos;
}

// Função para calcular o subtotal sem a taxa de entrega
function calcularSubtotal(pedidos) {
  let subtotal = 0;
  let resumo = '';
  pedidos.forEach(p => {
    const precoBase = CARDAPIO[p.tamanho] || 0;
    const precoBorda = p.borda ? CARDAPIO.Borda : 0;
    const subtotalItem = (precoBase + precoBorda) * p.qtd;
    subtotal += subtotalItem;
    resumo += `\n${p.qtd}x Pizza ${p.tamanho} (${p.sabores.join(' / ')}${p.borda ? ' + Borda' : ''}) – R$${subtotalItem.toFixed(2)}`;
  });
  return { resumo, subtotal };
}

function salvarPedidoCSV(dados) {
  const file = path.resolve(__dirname,'pedidos.csv');
  const hdr = 'nome,endereco,bairro,pagamento,pedidos,total,status,datahora,numero\n';
  if (!fs.existsSync(file)) fs.writeFileSync(file,hdr,'utf8');
  const linha = `\"${dados.nome}\",\"${dados.endereco}\",\"${dados.bairro}\",\"${dados.pagamento}\",\"${dados.pedidos}\",\"${dados.total.toFixed(2)}\",\"${dados.status}\",\"${moment().format('YYYY-MM-DD HH:mm')}\",\"${dados.numero}\"\n`;
  fs.appendFileSync(file,linha,'utf8');
}

function menuInicial(nomeCliente = 'Cliente') {
  return `🍕 Olá, ${nomeCliente}! Seja bem-vindo à Pizzaria Di Casa! 😄

📲 Peça rápido pelo Cardápio Digital:
👉 https://instadelivery.com.br/pizzariadicasa1

Ou escolha uma opção pelo WhatsApp:
1 - Ver Cardápio e fazer pedido
3 - Falar com Atendente
4 - Ver Promoções
5 - Ver Cardápio Digital`;
}

// Implementação do algoritmo de Levenshtein para comparação de strings
function levenshtein(s1, s2) {
    s1 = s1.toLowerCase();
    s2 = s2.toLowerCase();
    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i === 0) {
                costs[j] = j;
            } else if (j > 0) {
                let newValue = costs[j - 1];
                if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                    newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                }
                costs[j - 1] = lastValue;
                lastValue = newValue;
            }
        }
        if (i > 0) {
            costs[s2.length] = lastValue;
        }
    }
    return costs[s2.length];
}

// === Inicialização ===
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

if (!modoSimulacao) {
  client.on('qr', qr => qrcode.generate(qr, { small: true }));
  client.on('ready', () => console.log('✅ WhatsApp pronto!'));
  client.initialize();
}

// === Handler Principal ===
async function processarMensagem(from, raw, pushname) {
  const text = raw.trim().toLowerCase();
  let estado = pedidosEmAndamento.get(from);

  if (text === '0') {
    pedidosEmAndamento.delete(from);
    return enviar(from, menuInicial(pushname));
  }

  if (text === '99' && estado) {
    const idx = etapas.indexOf(estado.etapa);
    if (idx > 0) estado.etapa = etapas[idx - 1];
    return enviar(from, `Digite seu ${estado.etapa}:\n${exemplosEtapas[estado.etapa]}`);
  }

  if (!estado && /^(oi|ola|olá|menu|start|iniciar|bom dia|boa tarde|boa noite|quero pizza|cardapio)$/i.test(text)) {
    return enviar(from, menuInicial(pushname));
  }

  if (!estado) {
    // Nova lógica para capturar apenas o sabor e iniciar o fluxo de pedido
    const saborPedido = CARDAPIO.Sabores.find(sabor => text.includes(sabor.toLowerCase().replace('/catupiry', '')));
    if (saborPedido) {
      pedidosEmAndamento.set(from, { etapa: 'tamanho_quantidade', sabor: saborPedido });
      return enviar(from, `Certo! Você escolheu o sabor ${saborPedido}. Por favor, me diga a quantidade e o tamanho (P, G, F) da pizza. Exemplo: 1 G`);
    }

    if (text === '1' || text.includes('cardapio')) {
      return enviar(from, `📜 NOSSO CARDÁPIO 🍕
━━━━━━━━━━━━━━
🍕 Pizzas
• F (Família – 12 fatias) ........ R$ 55.00
• G (Grande – 8 fatias) .......... R$ 45.00
• P (Pequena – 4 fatias) ......... R$ 25.00

➕ Adicionais
• Borda recheada com cheddar ou catupiry ................ R$ 5.00

🥗 Sabores Disponíveis
• Portuguesa
• Calabresa
• Frango com Catupiry
• Muçarela
• Napolitana
• 4 Queijos

📌 Para fazer o pedido, digite no formato abaixo:
Exemplo: 1 G Calabresa com borda e 1 F metade Frango/Catupiry, metade Portuguesa`);
    }
    if (text === '2') return enviar(from, `Cardápio digital: https://instadelivery.com.br/pizzariadicasa1`);
    if (text === '3') return enviar(from, '👨‍🍳 Um atendente irá lhe atender em instantes.');
    if (text === '4') return enviar(from, '🔥 Promoção: Na compra de 2 G, ganhe 1 refrigerante 1L!');
    if (text === '5') return enviar(from, '📲 Cardápio digital: https://instadelivery.com.br/pizzariadicasa1');
  }

  // Lógica para tratar a resposta de quantidade e tamanho após a escolha do sabor
  if (estado && estado.etapa === 'tamanho_quantidade') {
    const regex = /(\d+)\s*(P|G|F)/i;
    const match = regex.exec(text);
    if (match) {
        const qtd = parseInt(match[1]);
        const tamanho = match[2].toUpperCase();
        const sabor = estado.sabor;

        const pedidos = [{ qtd, tamanho, sabores: [sabor], borda: false }];
        const { resumo, subtotal } = calcularSubtotal(pedidos);

        // Atualiza o estado do pedido para a próxima etapa
        pedidosEmAndamento.set(from, { resumo, subtotal, pedidos, etapa: 'nome' });

        return enviar(from, `🧾 RESUMO DO PEDIDO:${resumo}\n\nSubtotal: R$${subtotal.toFixed(2)}\n\nDigite seu nome:\n${exemplosEtapas.nome}`);
    } else {
        // Se a resposta não for válida, pede para tentar de novo
        return enviar(from, `❌ Não entendi. Por favor, digite a quantidade e o tamanho. Exemplo: 1 G`);
    }
  }

  // Lógica de parsing do pedido completo
  if (!estado && /\d+\s*(P|G|F)/i.test(raw) && /(calabresa|frango|portuguesa|queijos|borda|metade)/i.test(raw)) {
    const pedidos = parsePedido(raw);
    if (!pedidos.length) return enviar(from, '❌ Não entendi seu pedido. 📌 Exemplo: 1 G Calabresa com borda e 1 F metade Frango/Catupiry, metade Portuguesa');
    
    // Calcula o subtotal sem a taxa de entrega
    const { resumo, subtotal } = calcularSubtotal(pedidos);
    pedidosEmAndamento.set(from, { resumo, subtotal, pedidos, etapa:'nome' });
    
    return enviar(from, `🧾 RESUMO DO PEDIDO:${resumo}\n\nSubtotal: R$${subtotal.toFixed(2)}\n\nDigite seu nome:\n${exemplosEtapas.nome}`);
  }

  if (estado) {
    if (estado.etapa === 'nome' && !text.length) {
      return enviar(from, `❌ Por favor, digite um nome válido.`);
    }
    if (estado.etapa === 'endereco' && !text.length) {
      return enviar(from, `❌ Por favor, digite um endereço válido.`);
    }

    const etapaAtual = estado.etapa;
    estado[etapaAtual] = raw;

    const idx = etapas.indexOf(etapaAtual);
    
    // Lógica para a etapa do bairro
    if (etapaAtual === 'bairro') {
        const bairroNormalizado = estado.bairro.toLowerCase().trim();
        
        // Lógica de comparação aproximada para encontrar o bairro
        let bairroEncontrado = TAXAS_ENTREGA.padrao;
        let nomeBairroCorrigido = "Padrão";
        
        for (const bairro of Object.keys(TAXAS_ENTREGA)) {
            if (bairro === 'padrao') continue;
            const distance = levenshtein(bairroNormalizado, bairro);
            if (distance <= 2) { // Considera um match se a distância for menor ou igual a 2
                bairroEncontrado = TAXAS_ENTREGA[bairro];
                nomeBairroCorrigido = bairro;
                break;
            }
        }
        
        const total = estado.subtotal + bairroEncontrado;
        
        estado.taxaEntrega = bairroEncontrado;
        estado.total = total;
        estado.bairroCorrigido = nomeBairroCorrigido;

        const resumoCompleto = `${estado.resumo}\n\nSubtotal: R$${estado.subtotal.toFixed(2)}\nTaxa de entrega (${estado.bairroCorrigido}): R$${bairroEncontrado.toFixed(2)}\nTotal: R$${total.toFixed(2)}`;
        
        estado.resumoCompleto = resumoCompleto;
        estado.etapa = etapas[idx + 1];
        pedidosEmAndamento.set(from, estado);
        return enviar(from, `${resumoCompleto}\n\nDigite a forma de pagamento:\n${exemplosEtapas.pagamento}`);
    }

    // Se a etapa atual for a última, finalize o pedido
    if (idx === etapas.length - 1) {
      estado.status = estado.pagamento.toLowerCase().includes('pix') ? 'Pendente' : 'Pago';
      salvarPedidoCSV({
        nome: estado.nome,
        endereco: estado.endereco,
        bairro: estado.bairro,
        pagamento: estado.pagamento,
        pedidos: estado.resumo.replace(/\n/g,' | '),
        total: estado.total,
        status: estado.status,
        numero: from
      });

      if (estado.status === 'Pendente') {
        estado.aguardandoComprovante = true;
        pedidosEmAndamento.set(from, estado);
        return enviar(from, `💳 PIX — envie o comprovante (JPG, PNG ou PDF).\nChave: ${PIX_INFO.chave}\nNome: ${PIX_INFO.nome}\nBanco: ${PIX_INFO.banco}\nValor: R$${estado.total.toFixed(2)}`);
      } else {
        pedidosEmAndamento.delete(from);
        return enviar(from, `✅ Pedido confirmado! Previsão: 40 minutos.`);
      }
    } else {
      estado.etapa = etapas[idx + 1];
      pedidosEmAndamento.set(from, estado);
      return enviar(from, `Digite seu ${estado.etapa}:\n${exemplosEtapas[estado.etapa]}`);
    }
  }

  // 🚀 Se chegou aqui, o bot não entendeu — IA assume
  const respostaIA = await interpretarMensagem([{ role: 'cliente', text: raw }]);
  return enviar(from, respostaIA);
}

// === Escuta de mensagens ===
if (!modoSimulacao) {
  client.on('message', async msg => {
    const from = msg.from;
    const estado = pedidosEmAndamento.get(from);

    // Tratamento de comprovante
    if (estado && estado.aguardandoComprovante && msg.hasMedia) {
      const media = await msg.downloadMedia();
      const ext = media.mimetype.split('/')[1]; // jpg, png, pdf
      const filename = `${from.replace(/[^0-9]/g,'')}_${moment().format('YYYY-MM-DD_HH-mm')}.${ext}`;
      const filepath = path.join(DIR_COMPROVANTES, filename);
      fs.writeFileSync(filepath, media.data, 'base64');

      pedidosEmAndamento.delete(from);
      return enviar(from, `✅ Comprovante recebido! Seu pedido foi confirmado e está a caminho.`);
    }

    processarMensagem(from, msg.body, msg._data.notifyName || 'Cliente');
  });
} else {
  console.log('🧪 Simulação ativa — digite mensagens:');
  const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  readline.on('line', line => processarMensagem('cliente-simulado', line, 'Cliente Teste'));
}