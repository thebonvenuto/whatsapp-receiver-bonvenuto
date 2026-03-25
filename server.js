import express from "express";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(express.json({ limit: "5mb" }));

const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.get("/", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "whatsapp-receiver",
    status: "running"
  });
});

app.get("/health", (_req, res) => {
  res.status(200).send("ok");
});

function extractPhone(payload) {
  return (
    payload?.payload?.from ||
    payload?.payload?.to ||
    payload?.from ||
    payload?.to ||
    null
  );
}

function extractText(payload) {
  return (
    payload?.payload?.body ||
    payload?.payload?.text ||
    payload?.body ||
    payload?.text ||
    null
  );
}

app.post("/webhooks/waha", async (req, res) => {
  try {
    const body = req.body;

    const eventName = body?.event || null;
    const sessionName = body?.session || "default";
    const whatsappNumber = extractPhone(body);
    const content = extractText(body);

    if (!whatsappNumber) {
      return res.status(200).json({
        ok: true,
        ignored: true,
        reason: "no whatsapp number found"
      });
    }

    let { data: lead } = await supabase
      .from("leads")
      .select("*")
      .eq("whatsapp_number", whatsappNumber)
      .maybeSingle();

    if (!lead) {
      const { data: insertedLead, error: leadInsertError } = await supabase
        .from("leads")
        .insert({
          whatsapp_number: whatsappNumber,
          lead_status: "new",
          flow_stage: "start"
        })
        .select()
        .single();

      if (leadInsertError) throw leadInsertError;
      lead = insertedLead;
    }

    let { data: conversation } = await supabase
      .from("conversations")
      .select("*")
      .eq("lead_id", lead.id)
      .eq("conversation_status", "open")
      .maybeSingle();

    if (!conversation) {
      const { data: insertedConversation, error: convInsertError } = await supabase
        .from("conversations")
        .insert({
          lead_id: lead.id,
          channel: "whatsapp",
          conversation_status: "open"
        })
        .select()
        .single();

      if (convInsertError) throw convInsertError;
      conversation = insertedConversation;
    }

    const { error: messageInsertError } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversation.id,
        lead_id: lead.id,
        direction: "inbound",
        message_type: "text",
        content: content,
        raw_payload: body
      });

    if (messageInsertError) throw messageInsertError;

    return res.status(200).json({
      ok: true,
      received: true,
      event: eventName,
      session: sessionName,
      whatsapp_number: whatsappNumber
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "internal error"
    });
  }
});

console.log("Starting whatsapp-receiver...");
console.log("PORT:", PORT);
console.log("SUPABASE_URL exists:", !!process.env.SUPABASE_URL);
console.log("SUPABASE_SERVICE_ROLE_KEY exists:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`whatsapp-receiver listening on port ${PORT}`);
});
