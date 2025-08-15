// chatbot_pizzaria_fluxo_automatico.js - BOT Pizzaria Di Casa (Completo com Baileys e IA)
require('dotenv').config();

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage
} = require('@adiwajshing/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
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
    'vila nova': 6.00,
    'padrao': 8.00
};

const pedidosEmAndamento = new Map();
const etapas = ['nome', 'endereco', 'bairro', 'pagamento'];
const exemplosEtapas = {
    nome: "📌 Exemplo: João da Silva",
    endereco: "📌 Exemplo: Rua das Flores, nº 123, apto 45",
    bairro: "📌 Exemplo: Centro",
    pagamento: "📌 Exemplo: PIX ou Dinheiro"
};

let sock; // Declaração global para o socket do Baileys

// === Funções Utilitárias ===
const esperar = ms => new Promise(res => setTimeout(res, ms));

// Função de envio adaptada para o Baileys
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
        await sock.sendPresenceUpdate('composing', destino);
        await esperar(Math.min(2000 + texto.length * 10, 5000));
        await sock.sendMessage(destino, { text: texto });
        await sock.sendPresenceUpdate('paused', destino);
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

    // ... restante do código do handler continua aqui sem alteração ...
}

// === Conexão e Escuta de mensagens (adaptado para Baileys) ===
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão fechada. Reconectando...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ Conectado ao WhatsApp!');
        }

        if (qr) {
            console.log('QR Code gerado. Escaneie-o com seu celular.');
            qrcode.generate(qr, { small: true });
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type === 'notify') {
            const message = messages[0];
            const from = message.key.remoteJid;
            const pushname = message.pushName || 'Cliente';
            const body = message.message?.extendedTextMessage?.text || message.message?.conversation || '';

            if (from.endsWith('@g.us')) return; // Ignora grupos

            if (!message.key.fromMe) {
                let estado = pedidosEmAndamento.get(from);
                // Tratamento de comprovante
                if (estado && estado.aguardandoComprovante && message.message.imageMessage) {
                    const buffer = await downloadMediaMessage(
                        message,
                        'buffer',
                        {},
                        { reuploadRequest: sock.updateMediaMessage }
                    );

                    const ext = message.message.imageMessage.mimetype.split('/')[1];
                    const filename = `${from.replace(/[^0-9]/g,'')}_${moment().format('YYYY-MM-DD_HH-mm')}.${ext}`;
                    const filepath = path.join(DIR_COMPROVANTES, filename);
                    fs.writeFileSync(filepath, buffer);

                    pedidosEmAndamento.delete(from);
                    return enviar(from, `✅ Comprovante recebido! Seu pedido foi confirmado e está a caminho.`);
                }
                
                // Processa a mensagem de texto
                processarMensagem(from, body, pushname);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Apenas executa a conexão se não estiver em modo de simulação
if (!modoSimulacao) {
    connectToWhatsApp();
} else {
    console.log('🧪 Simulação ativa — digite mensagens:');
    const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    readline.on('line', line => processarMensagem('cliente-simulado', line, 'Cliente Teste'));
}
