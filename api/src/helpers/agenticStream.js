// =============================================================================
// agenticStream — shared SSE agentic loop used by ai-chat.js and ai-upload.js
//
// Usage:
//   const stats = await agenticStream({ anthropic, systemPrompt, messages,
//                                        tools, executeTool, res });
//   // stats: { responseText, toolsCalled, tokensIn, tokensOut, errorMsg }
//
// Caller responsibilities (before calling):
//   1. Set SSE response headers (Content-Type: text/event-stream, etc.)
//   2. Call res.flushHeaders()
// This function handles everything else: keepalive, while(true) loop,
// tool dispatch, done event, and res.end().
// =============================================================================

async function agenticStream({ anthropic, systemPrompt, messages, tools, executeTool, res }) {
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const keepalive = setInterval(() => res.write(': ping\n\n'), 10000);

  let responseText = '';
  const toolsCalled  = [];
  let tokensIn  = 0;
  let tokensOut = 0;
  let errorMsg  = null;

  try {
    // Guard against runaway loops
    let iterations = 0;
    const MAX_ITER = 12;

    while (iterations++ < MAX_ITER) {
      const stream = anthropic.messages.stream({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system:     systemPrompt,
        tools,
        messages,
      });

      let assistantContent = [];
      let currentBlock     = null;

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          currentBlock = { ...event.content_block, input_str: '' };
          if (currentBlock.type === 'tool_use') {
            send({ type: 'tool', name: currentBlock.name });
            toolsCalled.push(currentBlock.name);
          }
        }

        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            send({ type: 'text', text: event.delta.text });
            responseText += event.delta.text;
            if (currentBlock) currentBlock.text = (currentBlock.text || '') + event.delta.text;
          }
          if (event.delta.type === 'input_json_delta' && currentBlock) {
            currentBlock.input_str = (currentBlock.input_str || '') + event.delta.partial_json;
          }
        }

        if (event.type === 'content_block_stop' && currentBlock) {
          if (currentBlock.type === 'tool_use' && currentBlock.input_str) {
            try { currentBlock.input = JSON.parse(currentBlock.input_str); } catch { currentBlock.input = {}; }
          }
          assistantContent.push(currentBlock);
          currentBlock = null;
        }

        if (event.type === 'message_start' && event.message?.usage) {
          tokensIn += event.message.usage.input_tokens || 0;
        }
        if (event.type === 'message_delta' && event.usage) {
          tokensOut += event.usage.output_tokens || 0;
        }
      }

      const finalMsg = await stream.finalMessage();

      if (finalMsg.stop_reason === 'end_turn') {
        messages.push({ role: 'assistant', content: assistantContent });
        break;
      }

      if (finalMsg.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: assistantContent });

        const toolBlocks  = assistantContent.filter(b => b.type === 'tool_use');
        const toolResults = await Promise.all(
          toolBlocks.map(async (b) => {
            let result;
            try {
              result = await executeTool(b.name, b.input || {});
            } catch (err) {
              result = { error: err.message };
            }
            return {
              type:        'tool_result',
              tool_use_id: b.id,
              content:     JSON.stringify(result),
            };
          })
        );
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // Any other stop reason — break to avoid infinite loop
      break;
    }

  } catch (err) {
    errorMsg = err.message;
    if (err.status === 429) {
      send({ type: 'error', message: 'Rate limit reached. Please wait a moment before trying again.', retryAfter: 60 });
    } else {
      send({ type: 'error', message: err.message });
    }
  }

  clearInterval(keepalive);
  send({ type: 'done' });
  res.end();

  return { responseText, toolsCalled, tokensIn, tokensOut, errorMsg };
}

module.exports = { agenticStream };
