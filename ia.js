// ia.js
// Este arquivo contém a função que interage com um modelo de linguagem da OpenAI.
require('dotenv').config();

const OpenAI = require('openai');

/**
 * Função para interpretar uma mensagem do cliente usando um modelo de IA da OpenAI.
 * Implementa retentativas com espera exponencial em caso de falha na API.
 *
 * @param {Array} chatHistory - O histórico completo da conversa no formato da API.
 * @returns {Promise<string>} A resposta gerada pela IA.
 */
async function interpretarMensagem(chatHistory) {
    const maxRetries = 5;
    let retries = 0;
    let delay = 1000; // 1 segundo

    // ====================================================================
    //  ATENÇÃO: A chave da OpenAI agora é carregada das variáveis de ambiente
    // ====================================================================
    const apiKey = process.env.OPENAI_KEY;

    if (!apiKey) {
        console.error("❌ Erro: OPENAI_KEY não está definida no arquivo .env");
        return "Desculpe, estou com problemas técnicos no momento. Por favor, tente novamente mais tarde.";
    }
    
    // Configuração para o modelo da OpenAI (você pode mudar para outro, se preferir)
    const client = new OpenAI({ apiKey });
    const payload = {
        model: "gpt-4o-mini", // Modelo padrão, você pode usar outro como "gpt-3.5-turbo"
        messages: chatHistory.map(msg => ({
            role: msg.role === 'cliente' ? 'user' : 'assistant',
            content: msg.text
        }))
    };

    while (retries < maxRetries) {
        try {
            const result = await client.chat.completions.create(payload);

            if (result.choices && result.choices.length > 0 &&
                result.choices[0].message && result.choices[0].message.content) {
                // Retorna o texto da resposta da IA
                return result.choices[0].message.content;
            } else {
                // Retorna uma mensagem padrão se a resposta não for válida
                return "Desculpe, não consegui entender. Poderia tentar de novo?";
            }
        } catch (error) {
            console.error(`Tentativa ${retries + 1} falhou. Erro na IA: ${error.message}`);
            retries++;
            // Espera antes de tentar novamente (backoff exponencial)
            if (retries < maxRetries) {
                await new Promise(res => setTimeout(res, delay));
                delay *= 2; // Dobra o tempo de espera
            }
        }
    }
    // Retorna uma mensagem de erro após todas as tentativas falharem
    return "Desculpe, estou com problemas técnicos no momento. Por favor, tente novamente mais tarde.";
}

// Exporta a função para ser usada no arquivo principal
module.exports = { interpretarMensagem };