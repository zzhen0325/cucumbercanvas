/**
 * Quick DeepSeek API connectivity test.
 * Run: node scripts/test-deepseek.mjs
 */

const API_KEY = "sk-0873674f55334a98992cbd2ee07f8e7c";
const API_BASE = "https://api.deepseek.cn/v1";
const MODEL = "deepseek-chat";

async function testDeepSeek() {
  console.log("Testing DeepSeek API connectivity...\n");

  // Test 1: Basic chat completion (non-streaming)
  console.log("Test 1: Non-streaming chat completion...");
  const t1 = Date.now();
  try {
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: "Say hello in exactly 3 words." }],
        max_tokens: 50,
      }),
    });

    const data = await res.json();
    if (res.ok) {
      const reply = data.choices?.[0]?.message?.content;
      const usage = data.usage;
      console.log(`  OK (${Date.now() - t1}ms)`);
      console.log(`  Response: "${reply}"`);
      console.log(`  Usage: prompt=${usage?.prompt_tokens}, completion=${usage?.completion_tokens}, total=${usage?.total_tokens}`);
    } else {
      console.log(`  FAILED (${res.status})`);
      console.log(`  Error:`, JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.log(`  ERROR: ${err.message}`);
  }

  // Test 2: Streaming chat completion
  console.log("\nTest 2: Streaming chat completion...");
  const t2 = Date.now();
  try {
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: "Count from 1 to 5, one per line." }],
        max_tokens: 100,
        stream: true,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      console.log(`  FAILED (${res.status})`);
      console.log(`  Error:`, JSON.stringify(err, null, 2));
    } else {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let chunks = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n").filter((l) => l.startsWith("data: "));
        for (const line of lines) {
          const json = line.slice(6);
          if (json === "[DONE]") continue;
          try {
            const parsed = JSON.parse(json);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullText += content;
              chunks++;
            }
          } catch {}
        }
      }

      console.log(`  OK (${Date.now() - t2}ms, ${chunks} chunks)`);
      console.log(`  Full response:`);
      console.log(fullText.split("\n").map((l) => `    ${l}`).join("\n"));
    }
  } catch (err) {
    console.log(`  ERROR: ${err.message}`);
  }

  // Test 3: Try the v4-fast model
  console.log("\nTest 3: deepseek-v4-fast model...");
  const t3 = Date.now();
  try {
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-v4-fast",
        messages: [{ role: "user", content: "Reply with just: pong" }],
        max_tokens: 20,
      }),
    });

    const data = await res.json();
    if (res.ok) {
      const reply = data.choices?.[0]?.message?.content;
      console.log(`  OK (${Date.now() - t3}ms)`);
      console.log(`  Response: "${reply}"`);
    } else {
      console.log(`  FAILED (${res.status})`);
      console.log(`  Error: ${data.error?.message || JSON.stringify(data)}`);
    }
  } catch (err) {
    console.log(`  ERROR: ${err.message}`);
  }

  console.log("\nDone.");
}

testDeepSeek();
