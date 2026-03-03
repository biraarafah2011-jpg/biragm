// ─────────────────────────────────────────────────────────────
//  data.js  —  BIRA GM  —  Firebase logic & all app behaviour
// ─────────────────────────────────────────────────────────────

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth, sendSignInLinkToEmail, isSignInWithEmailLink,
  signInWithEmailLink, signOut, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getDatabase, ref, push, onValue, remove, set, get, runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// ── CONFIG ───────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyCJUDdgiyFOnZzpPhhtFakejKny2oSpxJ8",
  authDomain:        "biragm-website.firebaseapp.com",
  projectId:         "biragm-website",
  storageBucket:     "biragm-website.firebasestorage.app",
  messagingSenderId: "617255162677",
  appId:             "1:617255162677:web:97f32fd4b61d45ca61b27c",
  databaseURL:       "https://biragm-website-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

const ADMIN_EMAIL    = "biraarafah2011@gmail.com";
const ITEMS_PER_PAGE = 5;
const SHOWN_COMMENTS = 3;
const ACTION_CODE    = { url: "https://biragm-website.netlify.app/", handleCodeInApp: true };
const MIDTRANS_SERVER_KEY = "Mid-server-UTDNLi0Xs3UbgRmaxU1nA7_";

// ── INIT ─────────────────────────────────────────────────────
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getDatabase(app);

// ── STATE ────────────────────────────────────────────────────
let allItems      = [];
let filteredItems = [];
let currentPage   = 1;
let currentUser   = null;
let currentTab    = "free";
let unlockedItems = new Set();
let payingItem    = null;
let allComments   = [];
let selectedStar  = 0;
let selectedItemId = "";

// ═════════════════════════════════════════════════════════════
//  UTILS
// ═════════════════════════════════════════════════════════════
function esc(s) {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function timeAgo(ts) {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1)  return "baru saja";
  if (m < 60) return m + " mnt lalu";
  const h = Math.floor(m / 60);
  if (h < 24) return h + " jam lalu";
  const dy = Math.floor(h / 24);
  if (dy < 30) return dy + " hari lalu";
  return new Date(ts).toLocaleDateString("id-ID");
}

function starsHtml(rating, size = 13) {
  rating = Math.round(rating || 0);
  return `<div class="stars-display">
    ${[1,2,3,4,5].map(i =>
      `<span class="${i <= rating ? "filled" : ""}" style="width:${size}px;height:${size}px"></span>`
    ).join("")}
  </div>`;
}

// ── PRICE FORMAT ─────────────────────────────────────────────
window.formatPriceInput = (el) => {
  const raw = el.value.replace(/[^0-9]/g, "");
  el.value = raw ? "Rp " + Number(raw).toLocaleString("id-ID") : "";
};

function getRawPrice(el) {
  return parseInt((el.value || "").replace(/[^0-9]/g, "")) || 0;
}

// ═════════════════════════════════════════════════════════════
//  AUTH
// ═════════════════════════════════════════════════════════════
onAuthStateChanged(auth, user => {
  currentUser = user;
  renderAuthArea();
  renderCommentInput();

  if (user) {
    // Watch unlocked items for this user
    onValue(ref(db, "unlocked/" + user.uid), snap => {
      unlockedItems = snap.val() ? new Set(Object.keys(snap.val())) : new Set();
      renderCards();
    });
    if (user.email === ADMIN_EMAIL) {
      document.getElementById("adminPanel").classList.add("active");
    }
  } else {
    unlockedItems = new Set();
    document.getElementById("adminPanel").classList.remove("active");
    renderCards();
  }
});

function renderAuthArea() {
  const area = document.getElementById("authArea");
  if (currentUser) {
    const name = currentUser.displayName || currentUser.email.split("@")[0];
    area.innerHTML = `
      <div class="user-info">
        <div class="user-avatar">${name[0].toUpperCase()}</div>
        <button class="logout-btn" onclick="window._logout()">Keluar</button>
      </div>`;
  } else {
    area.innerHTML = `<button class="auth-btn" onclick="window._openModal()">Masuk</button>`;
  }
}

window._logout    = () => signOut(auth);
window._openModal = () => {
  document.getElementById("authModal").classList.add("active");
  document.getElementById("modalError").textContent = "";
};

// Magic link — send
window.handleSendLink = async () => {
  const email = document.getElementById("authEmail").value.trim();
  const name  = document.getElementById("authName").value.trim();
  const errEl = document.getElementById("modalError");
  errEl.textContent = "";
  if (!name)  { errEl.textContent = "Masukkan nama tampilan!"; return; }
  if (!email) { errEl.textContent = "Masukkan email!"; return; }
  try {
    localStorage.setItem("emailForSignIn", email);
    localStorage.setItem("nameForSignIn",  name);
    await sendSignInLinkToEmail(auth, email, ACTION_CODE);
    document.getElementById("modalStep1").style.display = "none";
    document.getElementById("modalStep2").style.display = "block";
    document.getElementById("sentToText").textContent =
      `Link dikirim ke ${email}. Cek inbox / spam. Berlaku 1 jam.`;
  } catch (e) {
    const msgs = {
      "auth/invalid-email":        "Format email tidak valid.",
      "auth/too-many-requests":    "Terlalu banyak percobaan.",
      "auth/operation-not-allowed":"Email Link belum aktif di Firebase."
    };
    errEl.textContent = msgs[e.code] || e.message;
  }
};

// Magic link — receive (redirect back)
if (isSignInWithEmailLink(auth, window.location.href)) {
  let email = localStorage.getItem("emailForSignIn");
  let name  = localStorage.getItem("nameForSignIn");
  if (!email) email = window.prompt("Konfirmasi emailmu:");
  if (email) {
    signInWithEmailLink(auth, email, window.location.href)
      .then(async r => {
        localStorage.removeItem("emailForSignIn");
        if (name && !r.user.displayName) {
          await updateProfile(r.user, { displayName: name });
          localStorage.removeItem("nameForSignIn");
        }
        window.history.replaceState({}, "", "/");
      })
      .catch(e => console.error("Magic link error:", e));
  }
}

window.closeModal = () => {
  document.getElementById("authModal").classList.remove("active");
  document.getElementById("modalError").textContent = "";
};
window.resetModal = () => {
  document.getElementById("modalStep1").style.display = "block";
  document.getElementById("modalStep2").style.display = "none";
};

// ═════════════════════════════════════════════════════════════
//  ITEMS  (Firebase Realtime DB)
// ═════════════════════════════════════════════════════════════
onValue(ref(db, "items"), snap => {
  const data = snap.val();
  allItems = data
    ? Object.entries(data).map(([id, v]) => ({ id, ...v })).reverse()
    : [];
  applyFilter();
  if (currentUser?.email === ADMIN_EMAIL) loadAdminList();
  // refresh comment input so item options stay updated
  if (currentUser) renderCommentInput();
});

function applyFilter() {
  const q = (document.getElementById("searchInput")?.value || "").toLowerCase();
  filteredItems = allItems.filter(i => {
    const matchTab = currentTab === "free" ? i.type !== "paid" : i.type === "paid";
    return matchTab && (!q || i.title.toLowerCase().includes(q));
  });
  currentPage = 1;
  renderCards();
  renderPagination();
}

// ── RENDER CARDS ─────────────────────────────────────────────
function renderCards() {
  const container = document.getElementById("cardsList");
  if (!filteredItems.length) {
    container.innerHTML = `<div class="empty-state">Belum ada konten di tab ini.</div>`;
    return;
  }

  const start     = (currentPage - 1) * ITEMS_PER_PAGE;
  const pageItems = filteredItems.slice(start, start + ITEMS_PER_PAGE);

  container.innerHTML = pageItems.map((item, i) => {
    const isPaid    = item.type === "paid";
    const isAdmin   = currentUser?.email === ADMIN_EMAIL;
    const isUnlocked = !isPaid || unlockedItems.has(item.id) || isAdmin;
    const clicks    = item.clicks || 0;
    const priceStr  = "Rp " + Number(item.price || 0).toLocaleString("id-ID");

    // ── LOCKED (paid & not bought) ──
    if (isPaid && !isUnlocked) {
      return `
      <div class="card-item" style="animation-delay:${i * .07}s">
        <div class="card-locked"
          onclick="window._openPayModal('${item.id}','${esc(item.title)}',${item.price || 0})">
          ${item.imgUrl
            ? `<img src="${esc(item.imgUrl)}"
                style="width:100%;display:block;object-fit:cover;
                       min-height:190px;max-height:290px;
                       border-radius:18px;filter:blur(6px)" alt="">`
            : `<div style="min-height:190px;background:linear-gradient(135deg,#1a3358,#0a1628);border-radius:18px"></div>`
          }
          <div class="card-locked-overlay">
            <div style="font-size:1.8rem">🔒</div>
            <div class="lock-text">${esc(item.title)}</div>
            <div class="lock-price">${priceStr}</div>
            <button class="unlock-btn">Beli Akses</button>
          </div>
        </div>
      </div>`;
    }

    // ── UNLOCKED / FREE ──
    return `
    <div class="card-item" style="animation-delay:${i * .07}s">
      <a class="card-image-wrap"
        href="${esc(item.linkUrl || "#")}"
        target="_blank" rel="noopener"
        onclick="incrementClick('${item.id}')">
        ${item.imgUrl
          ? `<img src="${esc(item.imgUrl)}" alt="${esc(item.title)}" loading="lazy">`
          : `<div class="card-image-placeholder">Tidak ada gambar</div>`
        }
        <div class="card-badge ${isPaid ? "badge-paid-tag" : "badge-free"}">
          ${isPaid ? "PREMIUM" : "GRATIS"}
        </div>
        <div class="card-click-count">
          <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" width="11" height="11">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          ${clicks.toLocaleString("id-ID")} klik
        </div>
      </a>
      <div class="card-title-box">
        <div class="card-title-row">
          <div class="card-title">${esc(item.title)}</div>
          <div class="card-click-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="12" height="12">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            ${clicks.toLocaleString("id-ID")}
          </div>
        </div>
        ${item.desc
          ? `<div class="card-desc-preview" id="prev-${item.id}" onclick="toggleDesc('${item.id}')">
               Lihat deskripsi
             </div>
             <div class="card-desc-full" id="desc-${item.id}">${esc(item.desc)}</div>`
          : ""
        }
      </div>
    </div>`;
  }).join("");
}

window.toggleDesc = id => {
  const el   = document.getElementById("desc-" + id);
  const prev = document.getElementById("prev-" + id);
  if (!el) return;
  el.classList.toggle("open");
  if (prev) prev.textContent = el.classList.contains("open") ? "Sembunyikan" : "Lihat deskripsi";
};

window.incrementClick = async id => {
  await runTransaction(ref(db, "items/" + id + "/clicks"), cur => (cur || 0) + 1);
};

// ── PAGINATION ────────────────────────────────────────────────
function renderPagination() {
  const total = Math.ceil(filteredItems.length / ITEMS_PER_PAGE);
  const pg    = document.getElementById("pagination");
  if (total <= 1) { pg.innerHTML = ""; return; }

  let html = currentPage > 1
    ? `<button class="page-btn" onclick="window._goPage(${currentPage - 1})">‹</button>`
    : "";
  for (let i = 1; i <= total; i++) {
    html += `<button class="page-btn ${i === currentPage ? "active" : ""}"
               onclick="window._goPage(${i})">${i}</button>`;
  }
  if (currentPage < total) {
    html += `<button class="page-btn" onclick="window._goPage(${currentPage + 1})">›</button>`;
  }
  pg.innerHTML = html;
}

window._goPage = p => {
  currentPage = p;
  renderCards();
  renderPagination();
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// ── TAB / SEARCH ──────────────────────────────────────────────
window.switchTab = tab => {
  currentTab = tab;
  document.getElementById("tabFree").classList.toggle("active", tab === "free");
  document.getElementById("tabPaid").classList.toggle("active", tab === "paid");
  applyFilter();
};

window.filterCards  = () => applyFilter();
window.toggleSearch = () => {
  document.getElementById("searchBar").classList.toggle("open");
  if (document.getElementById("searchBar").classList.contains("open")) {
    document.getElementById("searchInput").focus();
  }
};

// ═════════════════════════════════════════════════════════════
//  ADMIN
// ═════════════════════════════════════════════════════════════
window.togglePriceField = () => {
  document.getElementById("priceField").style.display =
    document.getElementById("typeInput").value === "paid" ? "block" : "none";
};

window.saveItem = async () => {
  const imgUrl  = document.getElementById("imgUrl").value.trim();
  const linkUrl = document.getElementById("linkUrl").value.trim();
  const title   = document.getElementById("titleInput").value.trim();
  const desc    = document.getElementById("descInput").value.trim();
  const type    = document.getElementById("typeInput").value;
  const price   = type === "paid" ? getRawPrice(document.getElementById("priceInput")) : 0;
  const editId  = document.getElementById("editId").value;

  if (!imgUrl || !linkUrl || !title) {
    alert("URL Gambar, URL Link, dan Judul wajib diisi!"); return;
  }

  const data = { imgUrl, linkUrl, title, desc, type, price, createdAt: Date.now(), clicks: 0 };

  if (editId) {
    const snap = await get(ref(db, "items/" + editId));
    data.clicks = snap.val()?.clicks || 0;
    await set(ref(db, "items/" + editId), data);
    cancelEditFn();
  } else {
    await push(ref(db, "items"), data);
    clearAdminForm();
  }
};

window.cancelEditFn = () => {
  document.getElementById("editId").value = "";
  document.getElementById("cancelEdit").style.display = "none";
  clearAdminForm();
};

function clearAdminForm() {
  ["imgUrl","linkUrl","titleInput","descInput","priceInput"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  document.getElementById("editId").value    = "";
  document.getElementById("typeInput").value = "free";
  document.getElementById("priceField").style.display = "none";
}

function loadAdminList() {
  const list = document.getElementById("adminItemsList");
  if (!allItems.length) {
    list.innerHTML = `<div style="color:var(--gray2);font-size:.8rem;margin-top:8px">Belum ada item.</div>`;
    return;
  }
  list.innerHTML =
    `<div style="color:var(--gold);font-size:.76rem;letter-spacing:1px;margin-bottom:8px;font-weight:800">
       DAFTAR (${allItems.length})
     </div>` +
    allItems.map(item => `
      <div class="admin-item">
        <div class="admin-item-info">
          <div class="admin-item-title">${esc(item.title)}</div>
          <div class="admin-item-meta">
            ${item.type === "paid"
              ? `<span class="meta-paid">BERBAYAR — Rp ${Number(item.price||0).toLocaleString("id-ID")}</span>`
              : `<span class="meta-free">GRATIS</span>`
            }
            &nbsp;·&nbsp;
            <span style="color:var(--gray2)">${(item.clicks||0)} klik</span>
          </div>
        </div>
        <button class="btn-sm btn-edit" onclick="window._editItem('${item.id}')">Edit</button>
        <button class="btn-sm btn-del"  onclick="window._deleteItem('${item.id}')">Hapus</button>
      </div>`
    ).join("");
}

window._editItem = id => {
  const item = allItems.find(i => i.id === id); if (!item) return;
  document.getElementById("editId").value    = id;
  document.getElementById("imgUrl").value    = item.imgUrl   || "";
  document.getElementById("linkUrl").value   = item.linkUrl  || "";
  document.getElementById("titleInput").value = item.title   || "";
  document.getElementById("descInput").value  = item.desc    || "";
  document.getElementById("typeInput").value  = item.type    || "free";
  if (item.price) {
    document.getElementById("priceInput").value =
      "Rp " + Number(item.price).toLocaleString("id-ID");
  }
  document.getElementById("priceField").style.display =
    item.type === "paid" ? "block" : "none";
  document.getElementById("cancelEdit").style.display = "inline-block";
  document.getElementById("adminPanel").scrollIntoView({ behavior: "smooth" });
};

window._deleteItem = async id => {
  if (confirm("Hapus item ini?")) await remove(ref(db, "items/" + id));
};

// ═════════════════════════════════════════════════════════════
//  PAYMENT  (Midtrans Snap)
// ═════════════════════════════════════════════════════════════
window._openPayModal = (id, title, price) => {
  if (!currentUser) { window._openModal(); return; }
  payingItem = { id, title, price };
  document.getElementById("payItemTitle").textContent = title;
  document.getElementById("payItemPrice").textContent =
    "Rp " + Number(price).toLocaleString("id-ID");
  document.getElementById("payModal").classList.add("active");
};

window.closePayModal = () => {
  document.getElementById("payModal").classList.remove("active");
  payingItem = null;
};

window.startPayment = async () => {
  if (!payingItem || !currentUser) return;

  const orderId = "biragm-" + payingItem.id.slice(-6) + "-" + Date.now();
  const name    = currentUser.displayName || currentUser.email.split("@")[0];

  const params = {
    transaction_details: { order_id: orderId, gross_amount: Number(payingItem.price) },
    customer_details:    { first_name: name, email: currentUser.email },
    item_details: [{
      id: payingItem.id, price: Number(payingItem.price),
      quantity: 1, name: payingItem.title
    }]
  };

  try {
    const res = await fetch("https://app.midtrans.com/snap/v1/transactions", {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + btoa(MIDTRANS_SERVER_KEY + ":")
      },
      body: JSON.stringify(params)
    });
    const data = await res.json();
    if (!data.token) { alert("Gagal membuat transaksi."); return; }

    closePayModal();
    const savedItem = { ...payingItem };
    const itemRef   = ref(db, "items/" + savedItem.id);

    window.snap.pay(data.token, {
      onSuccess: async result => {
        // Save unlock record
        await set(ref(db, "unlocked/" + currentUser.uid + "/" + savedItem.id), {
          orderId: result.order_id, paidAt: Date.now(), amount: savedItem.price
        });
        // Redirect to actual content URL
        const snap2   = await get(itemRef);
        const linkUrl = snap2.val()?.linkUrl;
        if (linkUrl) window.location.href = linkUrl;
      },
      onPending: () => alert("Menunggu konfirmasi pembayaran."),
      onError:   () => alert("Pembayaran gagal, silakan coba lagi."),
      onClose:   () => {}
    });
  } catch (e) { alert("Error: " + e.message); }
};

// ═════════════════════════════════════════════════════════════
//  COMMENTS & RATINGS
// ═════════════════════════════════════════════════════════════

// ── Comment input form ────────────────────────────────────────
function renderCommentInput() {
  const area = document.getElementById("commentInputArea");
  if (!currentUser) {
    area.innerHTML = `
      <div class="comment-login-prompt">
        Masuk untuk memberi ulasan
        <button onclick="window._openModal()">Masuk</button>
      </div>`;
    return;
  }

  const opts = allItems
    .map(i => `<option value="${i.id}">${esc(i.title)}</option>`)
    .join("");

  area.innerHTML = `
    <div class="comment-form">
      <div class="rating-row">
        <span class="rating-label">Ulasan untuk:</span>
        <select class="item-select" id="commentItemSel"
          onchange="window._onItemSelect(this.value)">
          <option value="">— Pilih konten —</option>
          ${opts}
        </select>
      </div>
      <div class="rating-row" id="starInputRow" style="display:none">
        <span class="rating-label">Rating:</span>
        <div class="stars-input" id="starsInput">
          ${[1,2,3,4,5].map(n =>
            `<span data-v="${n}"
               onmouseenter="hoverStar(${n})"
               onmouseleave="unhoverStar()"
               onclick="setStar(${n})"></span>`
          ).join("")}
        </div>
        <span id="starLabel" style="color:var(--gray2);font-size:.75rem"></span>
      </div>
      <textarea id="commentText" placeholder="Tulis ulasanmu..."></textarea>
      <button class="comment-submit" onclick="window._submitComment()">Kirim</button>
    </div>`;
}

window._onItemSelect = val => {
  selectedItemId = val;
  document.getElementById("starInputRow").style.display = val ? "flex" : "none";
};

// ── Star interaction ──────────────────────────────────────────
const starLabels = ["","Buruk","Kurang","Cukup","Bagus","Sangat Bagus"];

window.hoverStar = n => {
  document.querySelectorAll(".stars-input span").forEach((s,i) =>
    s.classList.toggle("hover", i < n));
  const lbl = document.getElementById("starLabel");
  if (lbl) lbl.textContent = starLabels[n];
};

window.unhoverStar = () => {
  document.querySelectorAll(".stars-input span").forEach(s =>
    s.classList.remove("hover"));
  updateStarDisplay();
};

window.setStar = n => {
  selectedStar = n;
  updateStarDisplay();
  const lbl = document.getElementById("starLabel");
  if (lbl) lbl.textContent = starLabels[n];
};

function updateStarDisplay() {
  document.querySelectorAll(".stars-input span").forEach((s,i) => {
    s.classList.toggle("on", i < selectedStar);
    s.classList.remove("hover");
  });
}

// ── Listen to comments ────────────────────────────────────────
onValue(ref(db, "comments"), snap => {
  const data = snap.val();
  allComments = data
    ? Object.entries(data)
        .map(([id,v]) => ({ id, ...v }))
        .sort((a,b) =>
          (b.replies ? Object.keys(b.replies).length : 0) -
          (a.replies ? Object.keys(a.replies).length : 0)
        )
    : [];
  renderComments();
  renderRatingSummary();
});

// ── Rating summary ────────────────────────────────────────────
function renderRatingSummary() {
  const withRating = allComments.filter(c => c.rating > 0);
  const el = document.getElementById("ratingSummary");
  if (!withRating.length) { el.innerHTML = ""; return; }

  const avg = withRating.reduce((s,c) => s + (c.rating||0), 0) / withRating.length;
  const counts = [0,0,0,0,0];
  withRating.forEach(c => { if (c.rating >= 1 && c.rating <= 5) counts[c.rating-1]++; });

  el.innerHTML = `
    <div class="rating-summary">
      <div class="rating-avg">${avg.toFixed(1)}</div>
      <div class="rating-stars-row">
        ${starsHtml(avg, 15)}
        <div class="rating-count">${withRating.length} ulasan</div>
      </div>
      <div style="flex:1;margin-left:8px">
        ${[5,4,3,2,1].map(n => {
          const pct = withRating.length
            ? Math.round(counts[n-1] / withRating.length * 100) : 0;
          return `
            <div style="display:flex;align-items:center;gap:5px;margin-bottom:2px">
              <span style="color:var(--gray2);font-size:.65rem;width:8px">${n}</span>
              <div style="flex:1;height:4px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden">
                <div style="width:${pct}%;height:100%;background:var(--gold);border-radius:2px"></div>
              </div>
            </div>`;
        }).join("")}
      </div>
    </div>`;
}

// ── Render comments list ──────────────────────────────────────
function renderComments(forceAll = false) {
  const list      = document.getElementById("commentsList");
  if (!allComments.length) {
    list.innerHTML = `<div style="color:var(--gray2);text-align:center;padding:18px;font-size:.85rem">
      Belum ada ulasan.
    </div>`;
    return;
  }

  const shown     = forceAll ? allComments : allComments.slice(0, SHOWN_COMMENTS);
  const remaining = allComments.length - SHOWN_COMMENTS;

  list.innerHTML = shown.map((c, idx) => {
    const itemTitle  = allItems.find(i => i.id === c.itemId)?.title || "";
    const replyList  = c.replies
      ? Object.entries(c.replies)
          .map(([rid,rv]) => ({ id: rid, ...rv }))
          .sort((a,b) => a.createdAt - b.createdAt)
      : [];
    const topReplies  = replyList.slice(0, 3);
    const moreReplies = replyList.slice(3);
    const isTop       = idx < 3 && replyList.length > 2;

    return `
    <div class="comment-item" id="ci-${c.id}">
      <div class="comment-header">
        <div class="comment-avatar">${(c.name||"?")[0].toUpperCase()}</div>
        <div class="comment-meta">
          <div class="comment-name">
            ${esc(c.name||"Anonim")}
            ${isTop ? `<span class="top-comment-badge">TOP</span>` : ""}
          </div>
          ${itemTitle ? `<div class="comment-item-ref">${esc(itemTitle)}</div>` : ""}
          ${c.rating  ? starsHtml(c.rating, 13) : ""}
        </div>
        <div class="comment-time">${timeAgo(c.createdAt)}</div>
      </div>
      <div class="comment-text">${esc(c.text)}</div>

      <div class="comment-actions">
        <button class="reply-btn" onclick="toggleReplyForm('${c.id}')">
          Balas${replyList.length ? ` (${replyList.length})` : ""}
        </button>
      </div>

      <div class="reply-form" id="rf-${c.id}">
        ${currentUser
          ? `<textarea id="rt-${c.id}" placeholder="Tulis balasan..." rows="2"></textarea>
             <button class="reply-submit" onclick="submitReply('${c.id}')">Kirim</button>
             <div style="clear:both"></div>`
          : `<div style="color:var(--gray2);font-size:.78rem;padding:6px 0">
               Masuk untuk membalas
             </div>`
        }
      </div>

      <div class="replies-wrap" id="rw-${c.id}">
        ${topReplies.map(r => `
          <div class="reply-item">
            <span class="reply-author">${esc(r.name||"?")}</span>
            <span class="reply-time">${timeAgo(r.createdAt)}</span>
            <div class="reply-text">${esc(r.text)}</div>
          </div>`).join("")}
        ${moreReplies.length
          ? `<button class="show-more-replies"
               onclick="showMoreReplies('${c.id}',this)"
               data-replies='${JSON.stringify(moreReplies)}'>
               Lihat ${moreReplies.length} balasan lainnya
             </button>`
          : ""
        }
      </div>
    </div>`;
  }).join("") +
  (!forceAll && remaining > 0
    ? `<button class="load-more-btn" onclick="renderComments(true)">
         Lihat ${remaining} ulasan lainnya
       </button>`
    : "");
}

// ── Reply interaction ─────────────────────────────────────────
window.toggleReplyForm = id => {
  document.getElementById("rf-" + id)?.classList.toggle("open");
};

window.showMoreReplies = (id, btn) => {
  const replies = JSON.parse(btn.dataset.replies || "[]");
  const wrap    = document.getElementById("rw-" + id);
  btn.remove();
  replies.forEach(r => {
    const el = document.createElement("div");
    el.className = "reply-item";
    el.innerHTML = `
      <span class="reply-author">${esc(r.name||"?")}</span>
      <span class="reply-time">${timeAgo(r.createdAt)}</span>
      <div class="reply-text">${esc(r.text)}</div>`;
    wrap.appendChild(el);
  });
};

window.submitReply = async commentId => {
  if (!currentUser) return;
  const ta   = document.getElementById("rt-" + commentId);
  const text = (ta?.value || "").trim();
  if (!text) return;
  const name = currentUser.displayName || currentUser.email.split("@")[0];
  await push(ref(db, "comments/" + commentId + "/replies"), {
    text, name, uid: currentUser.uid, createdAt: Date.now()
  });
  ta.value = "";
  document.getElementById("rf-" + commentId)?.classList.remove("open");
};

// ── Submit comment ────────────────────────────────────────────
window._submitComment = async () => {
  if (!currentUser) return;
  const text = document.getElementById("commentText").value.trim();
  if (!text) return;
  const name = currentUser.displayName || currentUser.email.split("@")[0];
  await push(ref(db, "comments"), {
    text, name,
    uid:    currentUser.uid,
    email:  currentUser.email,
    rating: selectedStar  || 0,
    itemId: selectedItemId || "",
    createdAt: Date.now()
  });
  document.getElementById("commentText").value = "";
  selectedStar   = 0;
  selectedItemId = "";
  renderCommentInput();
};

// ═════════════════════════════════════════════════════════════
//  MODAL CLOSE ON OVERLAY CLICK
// ═════════════════════════════════════════════════════════════
document.getElementById("authModal").addEventListener("click", e => {
  if (e.target === document.getElementById("authModal")) closeModal();
});
document.getElementById("payModal").addEventListener("click", e => {
  if (e.target === document.getElementById("payModal")) closePayModal();
});
