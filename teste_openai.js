require('dotenv').config();
const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_KEY });

(async () => {
  try {
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Olá, tudo bem?" }]
    });
    console.log("✅ Funcionando! Resposta da IA:");
    console.log(resp.choices[0].message.content);
  } catch (err) {
    console.error("❌ Erro na IA:", err.message);
  }
})();
