// netlify/functions/payment-webhook.js
// Saya Bayar mengirim notifikasi ke sini saat status invoice berubah
// Events yang didaftarkan: invoice.paid, invoice.expired, invoice.cancelled
// Unlock disimpan ke Firebase oleh SERVER — bukan oleh browser
//
// Di dashboard Saya Bayar, Webhook URL sudah diset ke:
//   https://biragm-website.netlify.app/.netlify/functions/payment-webhook

const https  = require("https");
const crypto = require("crypto");

// ── Verifikasi signature Saya Bayar (HMAC-SHA256 atas raw body) ─
function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  // timingSafeEqual butuh buffer dengan panjang sama
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── Helper: baca dari Firebase REST API ───────────────────────
function firebaseGet(path) {
  const dbUrl = process.env.FIREBASE_DB_URL;
  return new Promise((resolve, reject) => {
    const url = new URL(dbUrl + path + ".json");
    https.get(url.toString(), res => {
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error("Firebase parse error: " + raw)); }
      });
    }).on("error", reject);
  });
}

// ── Helper: tulis ke Firebase via REST ────────────────────────
function firebaseSet(path, data) {
  const dbUrl    = process.env.FIREBASE_DB_URL;
  const fbSecret = process.env.FIREBASE_DB_SECRET;
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify(data);
    const urlStr  = dbUrl + path + ".json" + (fbSecret ? "?auth=" + fbSecret : "");
    const url     = new URL(urlStr);
    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   "PUT",
      headers:  {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    };
    const req = https.request(options, res => {
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => resolve(raw));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── HANDLER ───────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const secret = process.env.SAYABAYAR_WEBHOOK_SECRET;
    if (!secret) {
      console.error("SAYABAYAR_WEBHOOK_SECRET belum diset di env");
      return { statusCode: 500, body: JSON.stringify({ error: "Server misconfigured" }) };
    }

    // ── 1. Ambil RAW body (penting — signature dihitung dari raw, bukan parsed) ─
    // Netlify Functions memberi event.body sebagai string mentah secara default.
    const rawBody = event.body;
    const signature = event.headers["x-webhook-signature"] || event.headers["X-Webhook-Signature"];

    // ── 2. Verifikasi signature ────────────────────────────────
    if (!verifySignature(rawBody, signature, secret)) {
      console.error("Signature mismatch — request palsu ditolak");
      return { statusCode: 401, body: JSON.stringify({ error: "Invalid signature" }) };
    }

    const notif = JSON.parse(rawBody);
    const eventType = notif.event;
    const data       = notif.data || {};
    const invoiceId  = data.invoice_id;

    if (!invoiceId) {
      return { statusCode: 400, body: JSON.stringify({ error: "invoice_id tidak ada di payload" }) };
    }

    // ── 3. Ambil pemetaan invoice -> item/order yang kita simpan saat create ─
    const mapping = await firebaseGet("/invoice_map/" + invoiceId);
    if (!mapping) {
      console.error("Tidak ada mapping untuk invoice:", invoiceId);
      return { statusCode: 200, body: JSON.stringify({ status: "ignored", reason: "no mapping found" }) };
    }

    // ── 4. Proses berdasarkan jenis event ──────────────────────
    if (eventType === "invoice.paid") {
      // Validasi jumlah yang dibayar cocok dengan harga asli item
      // (amount dari Saya Bayar bisa termasuk unique_code, jadi cek amount dasar)
      if (Number(data.amount) !== Number(mapping.amount)) {
        console.error("Jumlah tidak cocok:", data.amount, "vs", mapping.amount);
        return { statusCode: 200, body: JSON.stringify({ status: "ignored", reason: "amount mismatch" }) };
      }

      await firebaseSet("/verified_unlocked/" + mapping.orderId, {
        orderId:        mapping.orderId,
        itemId6:        mapping.itemId6,
        invoiceId:      invoiceId,
        invoiceNumber:  data.invoice_number || "",
        amount:         data.amount,
        paymentChannel: data.payment_channel || "",
        paidAt:         Date.now(),
        verified:       true
      });

      console.log("Unlock tersimpan untuk invoice:", invoiceId, "order:", mapping.orderId);

    } else if (eventType === "invoice.expired") {
      console.log("Invoice expired:", invoiceId);
      // Tidak ada unlock yang perlu ditulis — cukup dicatat

    } else if (eventType === "invoice.cancelled") {
      console.log("Invoice cancelled:", invoiceId);
      // Tidak ada unlock yang perlu ditulis — cukup dicatat

    } else {
      return { statusCode: 200, body: JSON.stringify({ status: "ignored", eventType }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ status: "ok" })
    };

  } catch (e) {
    console.error("payment-webhook error:", e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
