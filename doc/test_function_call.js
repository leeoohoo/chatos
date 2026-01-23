import OpenAI from "openai";

// Basic console logging with timestamps for traceability.
const log = (level, message, extra) => {
  const ts = new Date().toISOString();
  if (extra !== undefined) {
    console[level](`${ts} ${message}`, extra);
  } else {
    console[level](`${ts} ${message}`);
  }
};

const BASE_URL = "https://relay.nf.video/v1";
const MODEL = process.env.OPENAI_MODEL || "gpt-5.2-codex";
const API_KEY = "sk-ant-sid01--755be09a1ffba426ab33402481798b1a2676e29019a500b1a83e5e7e759c2fed";

if (!API_KEY) {
  throw new Error("OPENAI_API_KEY is not set. Please export it before running.");
}

const client = new OpenAI({
  apiKey: API_KEY,
  baseURL: BASE_URL,
  timeout: 60_000,
});

// Tool schema: a simple weather function to validate function calling.
const tools = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get the current weather for a given location.",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "City name, e.g. Beijing",
          },
          unit: {
            type: "string",
            enum: ["celsius", "fahrenheit"],
            description: "Temperature unit",
          },
        },
        required: ["location"],
      },
    },
  },
];

// Local function implementation used after tool call.
const getWeather = ({ location, unit = "celsius" }) => ({
  location,
  unit,
  temperature: 22,
  condition: "sunny",
});

const messages = [
  {
    role: "user",
    content: "What's the weather in Beijing today? Use celsius.",
  },
];

const run = async () => {
  log("info", `Using baseURL=${BASE_URL} model=${MODEL}`);

  let response;
  try {
    response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      tool_choice: "auto",
    });
  } catch (error) {
    log("error", "Initial request failed:", error);
    process.exitCode = 1;
    return;
  }

  const message = response.choices?.[0]?.message;
  log("info", "Assistant message:");
  log("info", JSON.stringify(message, null, 2));

  const toolCalls = message?.tool_calls || [];
  if (toolCalls.length === 0) {
    log(
      "warn",
      "No tool calls returned; function calling may not be supported by this endpoint."
    );
    return;
  }

  const toolMessages = [...messages, message];

  for (const call of toolCalls) {
    if (call.function?.name !== "get_weather") {
      log("warn", `Unexpected tool call: ${call.function?.name || "unknown"}`);
      continue;
    }

    let args = {};
    try {
      args = JSON.parse(call.function?.arguments || "{}");
    } catch (error) {
      log("error", "Failed to parse tool arguments:", error);
      process.exitCode = 1;
      return;
    }

    const result = getWeather(args);
    log("info", "Tool result:", result);

    toolMessages.push({
      role: "tool",
      tool_call_id: call.id,
      name: call.function.name,
      content: JSON.stringify(result),
    });
  }

  // Ask the model to explicitly confirm it used the tool output.
  toolMessages.push({
    role: "user",
    content: "Please answer exactly: 根据function返回的数据，北京的天气是22°C，晴天。",
  });

  try {
    const followUp = await client.chat.completions.create({
      model: MODEL,
      messages: toolMessages,
    });
    log("info", "Follow-up response:");
    log("info", followUp.choices?.[0]?.message?.content || "(empty)");
  } catch (error) {
    log("error", "Follow-up request failed:", error);
    process.exitCode = 1;
  }
};

run();
