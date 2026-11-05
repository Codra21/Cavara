import { CATEGORIES, PRODUCTS } from "./products.js";

const WHATSAPP_NUMBER = "8801788404459";
const MESSENGER_URL = "https://m.me/cavarabd";
const BAG_KEY = "cavara-bag-v1";
const PALETTE_KEY = "cavara-palette";
const MAX_QTY = 20;
const STUDIO_SLIDES = [
  { id: 2, eyebrow: "Breakfast, slowly", title: "A cup and plate made for one good morning.", word: "morning" },
  { id: 21, eyebrow: "Hand-decorated kitchen", title: "Bottles that earn their place on the counter.", word: "kitchen" },
  { id: 5, eyebrow: "Sculptural serveware", title: "Soft-edged dishes in four glazes.", word: "glazes" },
];
const STUDIO_PROMO_ID = 10;
const STUDIO_PAGE_SIZE = 8;
const STUDIO_LOOKBOOK = {
  productId: 5,
  image: "product-images/jba-oct/jba-yellow1.webp",
  spots: [
    { variant: 1, x: 50, y: 13 },
    { variant: 3, x: 21, y: 29 },
    { variant: 2, x: 89, y: 32 },
    { variant: 0, x: 79, y: 63 },
  ],
};
const STUDIO_CAROUSEL_CATEGORY = "drinkware";
const SLIDE_INTERVAL = 6500;
const RECENT_KEY = "cavara-recent-v1";
const RECENT_LIMIT = 8;

const PALETTES = [
  { id: "teal", name: "Cavara Teal", note: "Porcelain and logo teal", colors: ["#F7F4EF", "#224D4B", "#454547"], theme: "#F7F4EF" },
  { id: "terracotta", name: "Terracotta", note: "Fired clay and warm linen", colors: ["#F6EFE7", "#9B472A", "#3B2F2A"], theme: "#F6EFE7" },
  { id: "sage", name: "Sage", note: "Soft botanical greens", colors: ["#F0F2EA", "#4B6845", "#394038"], theme: "#F0F2EA" },
  { id: "blush", name: "Blush", note: "Rose porcelain and plum", colors: ["#F9F1F0", "#8A4155", "#4A3D42"], theme: "#F9F1F0" },
  { id: "indigo", name: "Indigo Glaze", note: "Blue-and-white ceramic", colors: ["#F2F4F7", "#2B4A85", "#3D4352"], theme: "#F2F4F7" },
  { id: "midnight", name: "Midnight", note: "Dark, low-light evenings", colors: ["#101716", "#8FCDB9", "#EEF1EC"], theme: "#101716" },
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const priceFormatter = new Intl.NumberFormat("en-US");
const formatPrice = (value) => `৳ ${priceFormatter.format(value)}`;
const categoryById = new Map(CATEGORIES.map((category) => [category.id, category]));
const productById = new Map(PRODUCTS.map((product) => [product.id, product]));
const productBySlug = new Map(PRODUCTS.map((product) => [product.slug, product]));
const productOrder = new Map(PRODUCTS.map((product, index) => [product.id, index]));
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  category: "all",
  query: "",
  sort: "featured",
  selectedVariant: new Map(PRODUCTS.map((product) => [product.id, 0])),
  bag: loadBag(),
  dialog: { productId: null, imageIndex: 0, quantity: 1, pushed: false },
  slideshow: { index: 0, timer: null, paused: false, hovered: false },
  studioExpanded: false,
  page: { productId: null, quantity: 1, returnScroll: 0, tab: "description", pushed: false },
  recent: loadRecent(),
};

const els = {
  header: $("[data-site-header]"),
  footerCollections: $("[data-footer-collections]"),
  filterChips: $("[data-filter-chips]"),
  productGrid: $("[data-product-grid]"),
  resultCount: $("[data-result-count]"),
  emptyState: $("[data-empty-state]"),
  emptyTitle: $("[data-empty-title]"),
  search: $("[data-product-search]"),
  sort: $("[data-product-sort]"),
  shop: $("#shop"),
  paletteTrigger: $("[data-palette-trigger]"),
  paletteMenu: $("#palette-menu"),
  paletteOptions: $("[data-palette-options]"),
  paletteDots: $("[data-palette-dots]"),
  paletteName: $("[data-palette-name]"),
  menuToggle: $("[data-menu-toggle]"),
  mobileNav: $("#mobile-nav"),
  bagButton: $("[data-open-bag]"),
  bagMirror: $("[data-bag-mirror]"),
  bagCountMirror: $("[data-bag-count-mirror]"),
  studioHero: $("[data-studio-hero]"),
  studioSlides: $("[data-studio-slides]"),
  studioDots: $("[data-studio-dots]"),
  studioPause: $("[data-studio-pause]"),
  studioCategories: $("[data-studio-categories]"),
  studioLookbook: $("[data-studio-lookbook]"),
  studioCarousel: $("[data-studio-carousel]"),
  studioFancy: $("[data-studio-fancy]"),
  studioCursor: $("[data-studio-cursor]"),
  studioCursorLabel: $("[data-studio-cursor-label]"),
  loadMoreWrap: $("[data-load-more-wrap]"),
  pdp: $("[data-pdp]"),
  loadMoreStatus: $("[data-load-more-status]"),
  studioPromo: $("[data-studio-promo]"),
  bagCount: $("[data-bag-count]"),
  bagDialog: $("[data-bag-dialog]"),
  bagList: $("[data-bag-list]"),
  bagEmpty: $("[data-bag-empty]"),
  bagFooter: $("[data-bag-footer]"),
  bagSummary: $("[data-bag-summary]"),
  bagSubtotal: $("[data-bag-subtotal]"),
  bagWhatsapp: $("[data-bag-whatsapp]"),
  bagMessenger: $("[data-bag-messenger]"),
  bagToast: $("[data-bag-toast]"),
  productDialog: $("[data-product-dialog]"),
  dialogImage: $("[data-dialog-image]"),
  dialogThumbs: $("[data-dialog-thumbs]"),
  dialogCount: $("[data-gallery-count]"),
  dialogCategory: $("[data-dialog-category]"),
  dialogTitle: $("[data-dialog-title]"),
  dialogPrice: $("[data-dialog-price]"),
  dialogSummary: $("[data-dialog-summary]"),
  dialogVariantName: $("[data-dialog-variant-name]"),
  dialogSwatches: $("[data-dialog-swatches]"),
  dialogQtyValue: $("[data-dialog-qty-value]"),
  dialogAdd: $("[data-dialog-add]"),
  dialogAddLabel: $("[data-dialog-add-label]"),
  dialogFeedback: $("[data-dialog-feedback]"),
  dialogWhatsapp: $("[data-dialog-whatsapp]"),
  dialogMessenger: $("[data-dialog-messenger]"),
  dialogDetails: $("[data-dialog-details]"),
  dialogNote: $("[data-dialog-note]"),
  toast: $("[data-toast]"),
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getVariant(product, index = state.selectedVariant.get(product.id) ?? 0) {
  return product.variants[index] ?? product.variants[0];
}

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private modes; the session still works.
  }
}

/* Palette */
function renderPaletteOptions() {
  const current = document.documentElement.dataset.palette || "teal";
  els.paletteOptions.innerHTML = PALETTES.map(
    (palette) => `
      <label class="palette-option">
        <input type="radio" name="palette" value="${palette.id}" ${palette.id === current ? "checked" : ""} />
        <span class="palette-option-dots" aria-hidden="true">${palette.colors.map((color) => `<i style="background:${color}"></i>`).join("")}</span>
        <span class="palette-option-text">
          <span class="palette-option-name">${palette.name}</span>
          <span class="palette-option-note">${palette.note}</span>
        </span>
        <i class="fa-solid fa-check palette-option-check" aria-hidden="true"></i>
      </label>`
  ).join("");
}

function applyPalette(id, { persist = true } = {}) {
  const palette = PALETTES.find((item) => item.id === id) ?? PALETTES[0];
  document.documentElement.dataset.palette = palette.id;
  els.paletteDots.innerHTML = palette.colors.map((color) => `<i style="background:${color}"></i>`).join("");
  els.paletteName.textContent = palette.name;
  els.paletteTrigger.setAttribute("aria-label", `Color palette: ${palette.name}`);
  $('meta[name="theme-color"]')?.setAttribute("content", palette.theme);
  const input = $(`input[name="palette"][value="${palette.id}"]`, els.paletteOptions);
  if (input) input.checked = true;
  if (persist) storageSet(PALETTE_KEY, palette.id);
}

function setPaletteMenu(open, { restoreFocus = false } = {}) {
  els.paletteMenu.hidden = !open;
  els.paletteTrigger.setAttribute("aria-expanded", String(open));
  if (open) {
    ($('input[name="palette"]:checked', els.paletteOptions) ?? $('input[name="palette"]', els.paletteOptions))?.focus();
  } else if (restoreFocus) {
    els.paletteTrigger.focus();
  }
}

/* Static storefront regions */
function countInCategory(categoryId) {
  return PRODUCTS.filter((product) => product.category === categoryId).length;
}

function renderFooterCollections() {
  els.footerCollections.innerHTML = CATEGORIES.map(
    (category) => `<li><button type="button" data-shop-category="${category.id}">${escapeHtml(category.name)}</button></li>`
  ).join("");
}

function renderFilters() {
  const filters = [{ id: "all", name: "All pieces", count: PRODUCTS.length }, ...CATEGORIES.map((category) => ({ ...category, count: countInCategory(category.id) }))];
  els.filterChips.innerHTML = filters.map(
    (filter) => `
      <button class="filter-chip" type="button" data-filter="${filter.id}" aria-pressed="${filter.id === state.category}">
        ${escapeHtml(filter.name)} <span class="filter-chip-count">${filter.count}</span>
      </button>`
  ).join("");
}


/* Product page */
const DEFAULT_TITLE = document.title;

function loadRecent() {
  try {
    const parsed = JSON.parse(storageGet(RECENT_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(Number).filter((id) => productById.has(id)).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

function rememberViewed(productId) {
  state.recent = [productId, ...state.recent.filter((id) => id !== productId)].slice(0, RECENT_LIMIT);
  storageSet(RECENT_KEY, JSON.stringify(state.recent));
}

function pageCard(product) {
  const variant = getVariant(product, 0);
  const category = categoryById.get(product.category);
  return `
    <li class="pdp-card">
      <button class="studio-carousel-card" type="button" data-open-product="${product.id}">
        <span class="studio-carousel-media"><img src="${escapeHtml(variant.images[0])}" alt="" loading="lazy" width="800" height="800" /></span>
        <span class="eyebrow">${escapeHtml(category?.name ?? "")}</span>
        <span class="studio-carousel-name">${escapeHtml(product.name)}</span>
        <span class="studio-carousel-price">${formatPrice(product.price)}</span>
      </button>
    </li>`;
}

function relatedProducts(product) {
  const same = PRODUCTS.filter((item) => item.id !== product.id && item.category === product.category);
  const others = PRODUCTS.filter((item) => item.id !== product.id && item.category !== product.category);
  return [...same, ...others].slice(0, 4);
}

function pageMessage(product, variant, quantity) {
  return singleOrderMessage(product, variant, quantity);
}

function renderProductPage() {
  const product = productById.get(state.page.productId);
  if (!product) return;
  const category = categoryById.get(product.category);
  const variantIndex = state.selectedVariant.get(product.id) ?? 0;
  const variant = getVariant(product, variantIndex);
  const pageUrl = new URL(productUrl(product), location.href).href;
  const colours = product.variants.map((item) => item.name).join(", ");
  const recent = state.recent.filter((id) => id !== product.id).slice(0, 4).map((id) => productById.get(id));
  const tabs = [
    { id: "description", label: "Description" },
    { id: "information", label: "Additional information" },
    { id: "ordering", label: "Ordering & delivery" },
  ];
  const bannerImage = product.variants.flatMap((item) => item.images).find((image) => !variant.images.includes(image)) ?? variant.images[variant.images.length - 1];

  els.pdp.innerHTML = `
    <div class="container">
      <nav class="pdp-crumbs" aria-label="Breadcrumb">
        <ol>
          <li><button type="button" data-page-home>Home</button></li>
          <li><button type="button" data-page-category="${category.id}">${escapeHtml(category.name)}</button></li>
          <li aria-current="page">${escapeHtml(product.name)}</li>
        </ol>
      </nav>

      <div class="pdp-main">
        <div class="pdp-gallery" data-page-gallery aria-label="${escapeHtml(product.name)} photos"></div>

        <div class="pdp-info">
          <div class="pdp-sticky">
            <p class="eyebrow">${escapeHtml(category.name)}${product.variants.length > 1 ? ` · ${pluralize(product.variants.length, "colour")}` : ""}</p>
            <h1 id="pdp-title" tabindex="-1">${escapeHtml(product.name)}</h1>
            <p class="pdp-price">${formatPrice(product.price)}</p>
            <p class="pdp-summary">${escapeHtml(product.summary)}</p>
            ${product.details?.length ? `<ul class="pdp-specs">${product.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}</ul>` : ""}

            <div class="pdp-option">
              <p class="pdp-option-label">Colour: <strong data-page-variant-name>${escapeHtml(variant.name)}</strong></p>
              <div class="pdp-swatches" role="group" aria-label="Choose a colour">
                ${product.variants.map((item, index) => swatchButton(product, item, index, variantIndex, { size: "large" })).join("")}
              </div>
            </div>

            <div class="pdp-buy" data-page-buy>
              <div class="quantity" role="group" aria-label="Quantity">
                <button type="button" data-page-qty="-1" aria-label="Decrease quantity"><i class="fa-solid fa-minus" aria-hidden="true"></i></button>
                <output data-page-qty-value aria-live="polite">${state.page.quantity}</output>
                <button type="button" data-page-qty="1" aria-label="Increase quantity"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
              </div>
              <button class="button pdp-add" type="button" data-page-add>Add to bag</button>
            </div>
            <a class="button button-outline pdp-now" href="${whatsappUrl(pageMessage(product, variant, state.page.quantity))}" target="_blank" rel="noopener" data-page-whatsapp>
              <i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Order now on WhatsApp</a>

            <div class="pdp-links">
              <a href="${MESSENGER_URL}" target="_blank" rel="noopener"><i class="fa-brands fa-facebook-messenger" aria-hidden="true"></i> Ask a question</a>
              <button type="button" data-page-copy="${escapeHtml(pageUrl)}"><i class="fa-regular fa-copy" aria-hidden="true"></i> Copy link</button>
              <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}" target="_blank" rel="noopener"><i class="fa-brands fa-facebook-f" aria-hidden="true"></i> Share</a>
            </div>

            <ul class="pdp-assurances">
              <li><i class="fa-regular fa-comments" aria-hidden="true"></i><span>Order in a chat on WhatsApp or Messenger, no account needed.</span></li>
              <li><i class="fa-regular fa-circle-check" aria-hidden="true"></i><span>Availability, delivery and payment are confirmed with you before anything is final.</span></li>
              <li><i class="fa-solid fa-location-dot" aria-hidden="true"></i><span>Based in West Nandipara, South Banasree, Dhaka.</span></li>
            </ul>
          </div>
        </div>
      </div>

      <div class="pdp-tabs" data-reveal>
        <div class="pdp-tablist" role="tablist" aria-label="Product information">
          ${tabs.map((tab) => `<button type="button" role="tab" id="pdp-tab-${tab.id}" aria-controls="pdp-panel-${tab.id}" aria-selected="${tab.id === state.page.tab}" tabindex="${tab.id === state.page.tab ? 0 : -1}" data-page-tab="${tab.id}">${tab.label}</button>`).join("")}
        </div>

        <div class="pdp-panel" role="tabpanel" id="pdp-panel-description" aria-labelledby="pdp-tab-description" tabindex="0" ${state.page.tab === "description" ? "" : "hidden"}>
          <div class="pdp-story">
            <div>
              <p class="eyebrow">About this piece</p>
              <h2>${escapeHtml(product.note || product.summary)}</h2>
              <p>${escapeHtml(product.summary)} Each piece is selected by the Cavara team for everyday use and the way it looks on a real table.</p>
            </div>
            <ul class="pdp-features">
              ${[...(product.details ?? []), `${pluralize(product.variants.length, "colour")} available`, `${pluralize(product.variants.reduce((sum, item) => sum + item.images.length, 0), "photo")} to compare`].slice(0, 4).map((feature, index) => `
                <li><i class="fa-solid ${["fa-ruler-combined", "fa-circle-half-stroke", "fa-palette", "fa-images"][index]}" aria-hidden="true"></i><span>${escapeHtml(feature)}</span></li>`).join("")}
            </ul>
          </div>
          <figure class="pdp-banner"><img src="${escapeHtml(bannerImage)}" alt="${escapeHtml(product.name)}" loading="lazy" width="1400" height="700" /></figure>
        </div>

        <div class="pdp-panel" role="tabpanel" id="pdp-panel-information" aria-labelledby="pdp-tab-information" tabindex="0" ${state.page.tab === "information" ? "" : "hidden"}>
          <table class="pdp-table">
            <tbody>
              <tr><th scope="row">Name</th><td>${escapeHtml(product.name)}</td></tr>
              <tr><th scope="row">Collection</th><td>${escapeHtml(category.name)}</td></tr>
              <tr><th scope="row">${product.variants.length > 1 ? "Colours" : "Colour"}</th><td>${escapeHtml(colours)}</td></tr>
              ${product.details?.length ? `<tr><th scope="row">Details</th><td>${product.details.map(escapeHtml).join("<br />")}</td></tr>` : ""}
              <tr><th scope="row">Price</th><td>${formatPrice(product.price)} per piece</td></tr>
            </tbody>
          </table>
        </div>

        <div class="pdp-panel" role="tabpanel" id="pdp-panel-ordering" aria-labelledby="pdp-tab-ordering" tabindex="0" ${state.page.tab === "ordering" ? "" : "hidden"}>
          <div class="pdp-ordering">
            <div>
              <h3>How ordering works</h3>
              <ol>
                <li>Choose your colour and quantity, then add the piece to your bag.</li>
                <li>Checkout sends your order to us on WhatsApp, or copies it for Messenger.</li>
                <li>Our team confirms availability, delivery and payment with you in chat.</li>
              </ol>
            </div>
            <div>
              <h3>Questions before you order?</h3>
              <p>Ask us about sizes, colours or anything else. We are happy to send extra photos.</p>
              <div class="pdp-ordering-actions">
                <a class="button" href="https://wa.me/${WHATSAPP_NUMBER}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i> WhatsApp us</a>
                <a class="text-link" href="${MESSENGER_URL}" target="_blank" rel="noopener">Message on Messenger</a>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section class="pdp-related" aria-labelledby="pdp-related-title">
        <h2 id="pdp-related-title" data-reveal>Related pieces</h2>
        <ul class="pdp-grid">${relatedProducts(product).map(pageCard).join("")}</ul>
      </section>

      ${recent.length ? `
      <section class="pdp-related" aria-labelledby="pdp-recent-title">
        <h2 id="pdp-recent-title" data-reveal>Recently viewed</h2>
        <ul class="pdp-grid">${recent.map(pageCard).join("")}</ul>
      </section>` : ""}
    </div>

    <div class="pdp-bar" data-page-bar aria-hidden="true" inert>
      <div class="container pdp-bar-inner">
        <img src="${escapeHtml(variant.images[0])}" alt="" width="64" height="64" data-page-bar-image />
        <div class="pdp-bar-text">
          <p>${escapeHtml(product.name)}</p>
          <p><span data-page-bar-variant>${escapeHtml(variant.name)}</span> · ${formatPrice(product.price)}</p>
        </div>
        <button class="button" type="button" data-page-add>Add to bag</button>
      </div>
    </div>`;

  renderPageGallery();
  observeReveals(els.pdp);
  watchPageBar();
}

function renderPageGallery() {
  const product = productById.get(state.page.productId);
  const variant = getVariant(product);
  const gallery = $("[data-page-gallery]", els.pdp);
  const images = variant.images;
  gallery.classList.toggle("is-single", images.length === 1);
  gallery.innerHTML = images.map(
    (image, index) => `
      <figure class="pdp-shot${index === 0 ? " is-lead" : ""}" data-page-shot>
        <img src="${escapeHtml(image)}" alt="${escapeHtml(`${product.name}, ${variant.name}, photo ${index + 1} of ${images.length}`)}" ${index === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} width="800" height="800" />
        <figcaption>${String(index + 1).padStart(2, "0")} / ${String(images.length).padStart(2, "0")}</figcaption>
      </figure>`
  ).join("");
  gallery.classList.remove("is-changing");
  void gallery.offsetWidth;
  gallery.classList.add("is-changing");
}

function updatePageVariant() {
  const product = productById.get(state.page.productId);
  const variantIndex = state.selectedVariant.get(product.id) ?? 0;
  const variant = getVariant(product, variantIndex);
  $("[data-page-variant-name]", els.pdp).textContent = variant.name;
  $("[data-page-bar-variant]", els.pdp).textContent = variant.name;
  $("[data-page-bar-image]", els.pdp).src = variant.images[0];
  $$(".pdp-swatches .swatch", els.pdp).forEach((swatch) => {
    const index = Number(swatch.dataset.variantIndex);
    swatch.setAttribute("aria-pressed", String(index === variantIndex));
    swatch.setAttribute("aria-label", `${product.variants[index].name}${index === variantIndex ? ", selected" : ""}`);
  });
  updatePageQuantity();
  renderPageGallery();
}

function updatePageQuantity() {
  const product = productById.get(state.page.productId);
  $("[data-page-qty-value]", els.pdp).textContent = String(state.page.quantity);
  $("[data-page-whatsapp]", els.pdp).href = whatsappUrl(pageMessage(product, getVariant(product), state.page.quantity));
  $$("[data-page-add]", els.pdp).forEach((button) => (button.textContent = state.page.quantity > 1 ? `Add ${state.page.quantity} to bag` : "Add to bag"));
}

let pageBarFrame = 0;
function updatePageBar() {
  pageBarFrame = 0;
  const buy = state.page.productId && $("[data-page-buy]", els.pdp);
  const bar = buy && $("[data-page-bar]", els.pdp);
  if (!bar) return;
  const show = buy.getBoundingClientRect().bottom < 0;
  if (bar.classList.contains("is-visible") === show) return;
  bar.classList.toggle("is-visible", show);
  bar.inert = !show;
  bar.setAttribute("aria-hidden", String(!show));
}

function queuePageBar() {
  if (!pageBarFrame) pageBarFrame = window.requestAnimationFrame(updatePageBar);
}

function watchPageBar() {
  const bar = $("[data-page-bar]", els.pdp);
  if (bar) {
    bar.classList.remove("is-visible");
    bar.inert = true;
    bar.setAttribute("aria-hidden", "true");
  }
  queuePageBar();
}

function openProductPage(productId, { push = true, variantIndex, pushed } = {}) {
  const product = productById.get(productId);
  if (!product) return;
  if (Number.isInteger(variantIndex) && product.variants[variantIndex]) state.selectedVariant.set(product.id, variantIndex);
  if (els.productDialog.open) hideProductDialog();
  state.dialog.pushed = false;
  if (els.bagDialog.open) closeModal(els.bagDialog);
  if (!state.page.productId) {
    state.page.returnScroll = window.scrollY;
    state.page.pushed = Boolean(pushed);
  }
  const changed = state.page.productId !== product.id;
  state.page.productId = product.id;
  if (changed) {
    state.page.quantity = 1;
    state.page.tab = "description";
  }
  rememberViewed(product.id);
  renderProductPage();
  els.pdp.hidden = false;
  document.documentElement.dataset.view = "product";
  document.title = `${product.name} — Cavara`;
  closeSpots();
  syncSlideshow();

  if (push && new URLSearchParams(location.search).get("product") !== product.slug) {
    if (history.state?.product) history.replaceState({ product: product.slug }, "", productUrl(product));
    else {
      history.pushState({ product: product.slug }, "", productUrl(product));
      state.page.pushed = true;
    }
  }
  window.scrollTo({ top: 0, behavior: "auto" });
  window.requestAnimationFrame(() => $("#pdp-title", els.pdp)?.focus({ preventScroll: true }));
}

function closeProductPage({ restoreScroll = true } = {}) {
  if (!state.page.productId) return;
  state.page.productId = null;
  state.page.pushed = false;
  els.pdp.hidden = true;
  els.pdp.innerHTML = "";
  delete document.documentElement.dataset.view;
  document.title = DEFAULT_TITLE;
  syncSlideshow();
  queueFancy();
  if (restoreScroll) window.scrollTo({ top: state.page.returnScroll, behavior: "auto" });
}

function leaveProductPage(after) {
  if (history.state?.product || new URLSearchParams(location.search).has("product")) {
    history.replaceState(null, "", cleanUrl());
  }
  closeProductPage({ restoreScroll: !after });
  after?.();
}

function selectPageTab(id, { focus = false } = {}) {
  state.page.tab = id;
  $$("[data-page-tab]", els.pdp).forEach((tab) => {
    const active = tab.dataset.pageTab === id;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  });
  $$(".pdp-panel", els.pdp).forEach((panel) => (panel.hidden = panel.id !== `pdp-panel-${id}`));
}

function setupPageZoom() {
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  els.pdp.addEventListener("pointermove", (event) => {
    const shot = event.target.closest?.("[data-page-shot]");
    if (!shot) return;
    const rect = shot.getBoundingClientRect();
    shot.style.setProperty("--zx", `${((event.clientX - rect.left) / rect.width) * 100}%`);
    shot.style.setProperty("--zy", `${((event.clientY - rect.top) / rect.height) * 100}%`);
    shot.classList.add("is-zooming");
  });
  els.pdp.addEventListener("pointerout", (event) => {
    const shot = event.target.closest?.("[data-page-shot]");
    if (shot && !shot.contains(event.relatedTarget)) shot.classList.remove("is-zooming");
  });
}

function productFromUrl() {
  const slug = new URLSearchParams(location.search).get("product");
  return slug ? productBySlug.get(slug) : null;
}

/* Studio layout */
function renderStudio() {
  els.studioSlides.innerHTML = STUDIO_SLIDES.map((slide, index) => {
    const product = productById.get(slide.id);
    const category = categoryById.get(product.category);
    const image = getVariant(product, 0).images[0];
    return `
      <article class="studio-slide" role="group" aria-roledescription="slide" aria-label="${index + 1} of ${STUDIO_SLIDES.length}: ${escapeHtml(product.name)}" data-studio-slide="${index}">
        <div class="studio-slide-media">
          <img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" ${index === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} width="800" height="800" />
          ${roundBadge(formatPrice(product.price), `${category.name} · Cavara · ${category.name} · Cavara · `)}
        </div>
        <span class="studio-slide-word" aria-hidden="true">${escapeHtml(slide.word)}</span>
        <div class="studio-slide-copy">
          <p class="eyebrow-line">${escapeHtml(slide.eyebrow)}</p>
          <h2 class="studio-slide-title">${escapeHtml(slide.title)}</h2>
          <p class="studio-slide-product">${escapeHtml(product.name)} <span>${formatPrice(product.price)}</span></p>
          <div class="studio-slide-actions">
            <button class="button" type="button" data-open-product="${product.id}">Shop now <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>
            <button class="text-link" type="button" data-shop-category="${category.id}">View ${escapeHtml(category.name.toLowerCase())}</button>
          </div>
        </div>
      </article>`;
  }).join("");

  els.studioDots.innerHTML = STUDIO_SLIDES.map(
    (slide, index) => `<button class="studio-dot" type="button" data-studio-dot="${index}" aria-label="Show slide ${index + 1}"><span></span></button>`
  ).join("");

  els.studioCategories.innerHTML = CATEGORIES.map(
    (category, index) => `
      <li data-reveal style="--reveal-delay:${index * 90}ms">
        <button class="studio-category" type="button" data-shop-category="${category.id}">
          <span class="studio-category-media"><img src="${escapeHtml(category.image)}" alt="" loading="lazy" width="800" height="1000" /></span>
          <span class="studio-category-label">
            <span class="studio-category-name">${escapeHtml(category.name)}</span>
            <span class="studio-category-count">${pluralize(countInCategory(category.id), "piece")}</span>
          </span>
        </button>
      </li>`
  ).join("");

  renderLookbook();
  renderCarousel();

  const promo = productById.get(STUDIO_PROMO_ID);
  const promoImages = promo.variants.flatMap((variant) => variant.images);
  els.studioPromo.innerHTML = `
    <div class="container-wide">
      <div class="studio-promo-grid" data-reveal>
        <div class="studio-promo-media">
          <img src="${escapeHtml(promoImages[1] ?? promoImages[0])}" alt="${escapeHtml(promo.name)} in several painted designs" loading="lazy" width="800" height="800" />
        </div>
        ${roundBadge(String(promo.variants.length), "Painted by hand · No two alike · ", "designs")}
        <div class="studio-promo-copy">
          <p class="sub-heading sub-heading-light">Painted by hand</p>
          <h2 id="studio-promo-title">${pluralize(promo.variants.length, "design")}, no two quite alike.</h2>
          <p>${escapeHtml(promo.summary)} Pick the pattern that suits your table, or mix a few for the family.</p>
          <p class="studio-promo-price">${escapeHtml(promo.name)} · ${formatPrice(promo.price)}</p>
        </div>
        <button class="studio-promo-tab" type="button" data-open-product="${promo.id}">Choose your design</button>
      </div>
    </div>`;

  showSlide(0);
}

let badgeCount = 0;
function roundBadge(value, ringText, caption = "") {
  const id = `badge-ring-${(badgeCount += 1)}`;
  return `
    <span class="round-badge" aria-hidden="true">
      <svg viewBox="0 0 100 100" class="round-badge-ring">
        <defs><path id="${id}" d="M50,50 m-38,0 a38,38 0 1,1 76,0 a38,38 0 1,1 -76,0" /></defs>
        <text><textPath href="#${id}" textLength="236">${escapeHtml(ringText.toUpperCase())}</textPath></text>
      </svg>
      <span class="round-badge-value">${escapeHtml(value)}${caption ? `<small>${escapeHtml(caption)}</small>` : ""}</span>
    </span>`;
}

function renderLookbook() {
  const product = productById.get(STUDIO_LOOKBOOK.productId);
  const spots = STUDIO_LOOKBOOK.spots.map((spot, index) => {
    const variant = getVariant(product, spot.variant);
    const id = `lookbook-spot-${index}`;
    return `
      <div class="studio-spot${spot.x < 35 ? " is-start" : spot.x > 65 ? " is-end" : ""}" style="--x:${spot.x}%;--y:${spot.y}%">
        <button class="studio-spot-button" type="button" aria-expanded="false" aria-controls="${id}" data-spot-toggle
          aria-label="${escapeHtml(`${product.name}, ${variant.name}`)}"><span aria-hidden="true"></span></button>
        <div class="studio-spot-card" id="${id}" hidden data-spot-card>
          <img src="${escapeHtml(variant.images[0])}" alt="" loading="lazy" width="160" height="160" />
          <div>
            <p class="studio-spot-name">${escapeHtml(product.name)}</p>
            <p class="studio-spot-meta">${escapeHtml(variant.name)} · ${formatPrice(product.price)}</p>
            <button class="text-link" type="button" data-open-product="${product.id}" data-open-variant="${spot.variant}">View piece</button>
          </div>
        </div>
      </div>`;
  }).join("");

  const lead = getVariant(product, 0);
  els.studioLookbook.innerHTML = `
    <div class="container-wide">
      <div class="studio-lookbook-grid">
        <div class="studio-lookbook-media" data-reveal>
          <img src="${escapeHtml(STUDIO_LOOKBOOK.image)}" alt="${escapeHtml(product.name)} in ${product.variants.length} glazes, styled on a breakfast table" loading="lazy" width="800" height="800" />
          ${spots}
        </div>
        <div class="studio-lookbook-copy" data-reveal>
          <span class="studio-lookbook-word" aria-hidden="true">glazes</span>
          <p class="sub-heading">Shop the table</p>
          <h2 id="studio-lookbook-title">One dish, ${product.variants.length} glazes, set for breakfast.</h2>
          <p class="studio-lookbook-note">Tap a marker to see each colour of the ${escapeHtml(product.name)}, then open it to choose yours.</p>
          <button class="studio-lookbook-card" type="button" data-open-product="${product.id}">
            <span class="studio-lookbook-card-media"><img src="${escapeHtml(lead.images[0])}" alt="" loading="lazy" width="400" height="400" /></span>
            <span class="studio-lookbook-card-name">${escapeHtml(product.name)}</span>
            <span class="studio-lookbook-card-price">${formatPrice(product.price)} each</span>
          </button>
          <button class="button" type="button" data-open-product="${product.id}">Shop the look <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>
        </div>
      </div>
    </div>`;
}

function renderCarousel() {
  const category = categoryById.get(STUDIO_CAROUSEL_CATEGORY);
  const products = PRODUCTS.filter((product) => product.category === category.id);
  els.studioCarousel.innerHTML = `
    <div class="container-wide">
      <div class="section-head" data-reveal>
        <p class="sub-heading">People also love · ${pluralize(products.length, "piece")}</p>
        <h2 id="studio-carousel-title">The ${escapeHtml(category.name.toLowerCase())} edit</h2>
      </div>
      <div class="studio-carousel-arrows">
        <button class="studio-arrow" type="button" data-carousel-step="-1" aria-label="Scroll ${escapeHtml(category.name)} back"><i class="fa-solid fa-arrow-left-long" aria-hidden="true"></i></button>
        <button class="studio-arrow" type="button" data-carousel-step="1" aria-label="Scroll ${escapeHtml(category.name)} forward"><i class="fa-solid fa-arrow-right-long" aria-hidden="true"></i></button>
      </div>
    </div>
    <ul class="studio-carousel" data-carousel-track aria-label="${escapeHtml(category.name)}">
      ${products.map((product) => {
        const variant = getVariant(product, 0);
        return `
          <li class="studio-carousel-item">
            <button class="studio-carousel-card" type="button" data-open-product="${product.id}">
              <span class="studio-carousel-media"><img src="${escapeHtml(variant.images[0])}" alt="" loading="lazy" width="800" height="800" draggable="false" /></span>
              <span class="eyebrow">${product.variants.length > 1 ? pluralize(product.variants.length, "colour") : escapeHtml(variant.name)}</span>
              <span class="studio-carousel-name">${escapeHtml(product.name)}</span>
              <span class="studio-carousel-price">${formatPrice(product.price)}</span>
            </button>
          </li>`;
      }).join("")}
    </ul>`;
  updateCarouselButtons();
}

function updateCarouselButtons() {
  const track = $("[data-carousel-track]", els.studioCarousel);
  if (!track) return;
  const max = track.scrollWidth - track.clientWidth - 2;
  $$("[data-carousel-step]", els.studioCarousel).forEach((button) => {
    button.disabled = Number(button.dataset.carouselStep) < 0 ? track.scrollLeft <= 2 : track.scrollLeft >= max;
  });
}

function stepCarousel(direction) {
  const track = $("[data-carousel-track]", els.studioCarousel);
  const item = $(".studio-carousel-item", track);
  const step = item ? item.getBoundingClientRect().width + 24 : track.clientWidth * 0.8;
  track.scrollBy({ left: direction * step, behavior: prefersReducedMotion.matches ? "auto" : "smooth" });
}

function setSpot(button, open) {
  const card = document.getElementById(button.getAttribute("aria-controls"));
  button.setAttribute("aria-expanded", String(open));
  card.hidden = !open;
  button.closest(".studio-spot").classList.toggle("is-open", open);
}

function closeSpots(except) {
  $$("[data-spot-toggle][aria-expanded='true']").forEach((button) => {
    if (button !== except) setSpot(button, false);
  });
}

/* Scroll-driven Studio motion */
let revealObserver;
function observeReveals(root = document) {
  if (!revealObserver) return;
  $$("[data-reveal]:not(.is-revealed)", root).forEach((element) => revealObserver.observe(element));
}

function setupReveals() {
  if (prefersReducedMotion.matches || !("IntersectionObserver" in window)) return;
  revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-revealed");
        revealObserver.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
  );
  document.documentElement.classList.add("has-reveal");
  observeReveals();
}

let fancyFrame = 0;
function updateFancy() {
  fancyFrame = 0;
  if (document.documentElement.dataset.view) return;
  const rect = els.studioFancy.getBoundingClientRect();
  const progress = Math.min(1, Math.max(0, (window.innerHeight - rect.top) / (window.innerHeight * 0.75 + rect.height)));
  els.studioFancy.style.setProperty("--fill", `${Math.round(progress * 1000) / 10}%`);
}

function queueFancy() {
  if (!fancyFrame) fancyFrame = window.requestAnimationFrame(updateFancy);
}

function setupCursor() {
  if (prefersReducedMotion.matches || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  const cursor = els.studioCursor;
  const position = { x: 0, y: 0, tx: 0, ty: 0, frame: 0 };
  const render = () => {
    position.x += (position.tx - position.x) * 0.22;
    position.y += (position.ty - position.y) * 0.22;
    cursor.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    position.frame = Math.abs(position.tx - position.x) + Math.abs(position.ty - position.y) > 0.4 ? window.requestAnimationFrame(render) : 0;
  };
  const zones = [
    { selector: ".studio-slide-media", label: (event, zone) => (event.clientX < zone.getBoundingClientRect().left + zone.clientWidth / 2 ? "Prev" : "Next") },
    { selector: "[data-carousel-track]", label: () => "Drag" },
    { selector: ".studio-lookbook-media img", label: () => "Explore" },
  ];
  document.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    const match = zones.map((zone) => ({ zone, element: event.target.closest?.(zone.selector) })).find((item) => item.element);
    const overControl = event.target.closest?.("button:not(.studio-carousel-card), a, input, select");
    if (!match || (overControl && !event.target.closest(".studio-carousel-card"))) {
      cursor.classList.remove("is-visible");
      document.documentElement.classList.remove("cursor-hidden");
      return;
    }
    els.studioCursorLabel.textContent = match.zone.label(event, match.element);
    position.tx = event.clientX;
    position.ty = event.clientY;
    if (!cursor.classList.contains("is-visible")) {
      position.x = position.tx;
      position.y = position.ty;
    }
    cursor.classList.add("is-visible");
    document.documentElement.classList.add("cursor-hidden");
    if (!position.frame) position.frame = window.requestAnimationFrame(render);
  }, { passive: true });
  document.addEventListener("pointerleave", () => cursor.classList.remove("is-visible"));
}

function setupCarouselDrag() {
  const track = () => $("[data-carousel-track]", els.studioCarousel);
  let drag = null;
  els.studioCarousel.addEventListener("pointerdown", (event) => {
    const element = track();
    if (event.pointerType !== "mouse" || !element?.contains(event.target)) return;
    drag = { startX: event.clientX, scroll: element.scrollLeft, moved: false };
  });
  window.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const delta = event.clientX - drag.startX;
    if (Math.abs(delta) > 4) {
      drag.moved = true;
      track().classList.add("is-dragging");
    }
    if (drag.moved) track().scrollLeft = drag.scroll - delta;
  });
  window.addEventListener("pointerup", () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    track().classList.remove("is-dragging");
    if (moved) {
      // Swallow the click that follows a drag so cards do not open.
      window.addEventListener("click", (event) => { event.stopPropagation(); event.preventDefault(); }, { capture: true, once: true });
    }
  });
  els.studioCarousel.addEventListener("scroll", updateCarouselButtons, { capture: true, passive: true });
  window.addEventListener("resize", updateCarouselButtons, { passive: true });
}

function showSlide(index) {
  const total = STUDIO_SLIDES.length;
  state.slideshow.index = (index + total) % total;
  $$("[data-studio-slide]", els.studioSlides).forEach((slide, slideIndex) => {
    const active = slideIndex === state.slideshow.index;
    slide.classList.toggle("is-active", active);
    slide.classList.toggle("is-before", slideIndex < state.slideshow.index);
    slide.inert = !active;
    slide.setAttribute("aria-hidden", String(!active));
  });
  $$("[data-studio-dot]", els.studioDots).forEach((dot, dotIndex) => {
    if (dotIndex === state.slideshow.index) dot.setAttribute("aria-current", "true");
    else dot.removeAttribute("aria-current");
  });
}

function syncSlideshow() {
  window.clearInterval(state.slideshow.timer);
  const { paused, hovered } = state.slideshow;
  const running = !document.documentElement.dataset.view && !paused && !hovered && !document.hidden;
  if (running) state.slideshow.timer = window.setInterval(() => showSlide(state.slideshow.index + 1), SLIDE_INTERVAL);
  els.studioHero.classList.toggle("is-running", running);
  els.studioPause.setAttribute("aria-label", paused ? "Play slideshow" : "Pause slideshow");
  els.studioPause.innerHTML = `<i class="fa-solid ${paused ? "fa-play" : "fa-pause"}" aria-hidden="true"></i>`;
}

/* Header: shadow once scrolled, tucks away while scrolling down */
let headerFrame = 0;
let lastScrollY = window.scrollY;
function updateHeader() {
  headerFrame = 0;
  const y = window.scrollY;
  const menuOpen = !els.mobileNav.hidden || !els.paletteMenu.hidden;
  els.header.classList.toggle("is-scrolled", y > 8);
  if (menuOpen || y < 480) els.header.classList.remove("is-tucked");
  else if (Math.abs(y - lastScrollY) > 4) els.header.classList.toggle("is-tucked", y > lastScrollY);
  if (Math.abs(y - lastScrollY) > 4) lastScrollY = y;
}

function queueHeader() {
  if (!headerFrame) headerFrame = window.requestAnimationFrame(updateHeader);
}

/* Product listing */
function searchableText(product) {
  const category = categoryById.get(product.category)?.name ?? "";
  return [product.name, category, product.summary, ...(product.details ?? []), ...product.variants.map((variant) => variant.name)]
    .join(" ")
    .toLowerCase();
}

function getVisibleProducts() {
  const terms = state.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const products = PRODUCTS.filter((product) => {
    if (state.category !== "all" && product.category !== state.category) return false;
    const text = searchableText(product);
    return terms.every((term) => text.includes(term));
  });

  const sorters = {
    featured: (a, b) => productOrder.get(a.id) - productOrder.get(b.id),
    "price-asc": (a, b) => a.price - b.price || a.name.localeCompare(b.name),
    "price-desc": (a, b) => b.price - a.price || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return products.sort(sorters[state.sort] ?? sorters.featured);
}

function swatchButton(product, variant, index, selectedIndex, { size = "small" } = {}) {
  const label = `${variant.name}${index === selectedIndex ? ", selected" : ""}`;
  return `
    <button class="swatch" type="button" data-variant-product="${product.id}" data-variant-index="${index}" data-swatch-size="${size}"
      aria-pressed="${index === selectedIndex}" aria-label="${escapeHtml(label)}" title="${escapeHtml(variant.name)}">
      <span style="background:${escapeHtml(variant.swatch)}"></span>
    </button>`;
}

function productCard(product, index) {
  const selectedIndex = state.selectedVariant.get(product.id) ?? 0;
  const variant = getVariant(product, selectedIndex);
  const category = categoryById.get(product.category);
  const visibleSwatches = product.variants.slice(0, 5);
  const hiddenCount = product.variants.length - visibleSwatches.length;
  const altImage = variant.images[1];
  return `
    <li class="product-card" data-product-card="${product.id}" data-reveal style="--reveal-delay:${(index % 4) * 80}ms">
      <div class="product-media">
        <button class="product-media-button" type="button" data-open-product="${product.id}" tabindex="-1" aria-hidden="true">
          <img class="product-image" data-card-image src="${escapeHtml(variant.images[0])}" alt="${escapeHtml(`${product.name}, ${variant.name}`)}" loading="lazy" decoding="async" width="800" height="1000" />
          ${altImage ? `<img class="product-image-alt" data-card-alt-image src="${escapeHtml(altImage)}" alt="" loading="lazy" decoding="async" width="800" height="1000" />` : ""}
        </button>
        ${product.variants.length > 1 ? `<span class="product-badge">${pluralize(product.variants.length, "colour")}</span>` : ""}
        <div class="product-icons">
          <button class="card-icon" type="button" data-open-product="${product.id}" tabindex="-1" aria-hidden="true" title="View full details">
            <i class="fa-solid fa-up-right-and-down-left-from-center" aria-hidden="true"></i>
          </button>
        </div>
        <div class="product-actions">
          <button class="quick-add" type="button" data-quick-add="${product.id}" aria-label="Add ${escapeHtml(product.name)}, ${escapeHtml(variant.name)}, to bag">
            <i class="fa-solid fa-bag-shopping" aria-hidden="true"></i><span>Add to bag</span>
          </button>
          <button class="card-quick-view" type="button" data-open-product="${product.id}" data-quick-view aria-label="Quick view ${escapeHtml(product.name)}">
            <i class="fa-regular fa-eye" aria-hidden="true"></i><span>Quick view</span>
          </button>
        </div>
      </div>
      <div class="product-info">
        <p class="product-meta">${escapeHtml(category?.name ?? "")}</p>
        <h3 class="product-name"><button type="button" data-open-product="${product.id}">${escapeHtml(product.name)}</button></h3>
        <p class="product-price">${formatPrice(product.price)}</p>
        <div class="product-swatches" role="group" aria-label="${escapeHtml(product.name)} colours">
          ${visibleSwatches.map((item, itemIndex) => swatchButton(product, item, itemIndex, selectedIndex)).join("")}
          ${hiddenCount > 0 ? `<button class="swatch-more" type="button" data-open-product="${product.id}" aria-label="View all ${product.variants.length} colours">+${hiddenCount}</button>` : ""}
        </div>
        <p class="product-variant-name" data-card-variant-name>${escapeHtml(variant.name)}</p>
      </div>
    </li>`;
}

function renderProducts() {
  const products = getVisibleProducts();
  els.productGrid.innerHTML = products.map(productCard).join("");
  const collapsed = !state.studioExpanded && products.length > STUDIO_PAGE_SIZE;
  els.productGrid.classList.toggle("is-collapsed", collapsed);
  els.loadMoreWrap.hidden = !collapsed;
  els.loadMoreStatus.textContent = `Showing ${STUDIO_PAGE_SIZE} of ${products.length}`;
  observeReveals(els.productGrid);
  els.emptyState.hidden = products.length > 0;
  els.productGrid.hidden = products.length === 0;

  const category = state.category === "all" ? null : categoryById.get(state.category);
  const scope = category ? ` in ${category.name}` : "";
  const query = state.query.trim();
  els.resultCount.textContent = query
    ? `${pluralize(products.length, "piece")}${scope} for “${query}”`
    : `Showing ${pluralize(products.length, "piece")}${scope}`;
  els.emptyTitle.textContent = query ? `No pieces match “${query}”` : "No pieces in this collection yet";
  $$("[data-filter]", els.filterChips).forEach((chip) => chip.setAttribute("aria-pressed", String(chip.dataset.filter === state.category)));
}

function updateCard(productId) {
  const card = $(`[data-product-card="${productId}"]`, els.productGrid);
  if (!card) return;
  const product = productById.get(productId);
  const selectedIndex = state.selectedVariant.get(productId) ?? 0;
  const variant = getVariant(product, selectedIndex);
  const image = $("[data-card-image]", card);
  const altImage = $("[data-card-alt-image]", card);
  image.src = variant.images[0];
  image.alt = `${product.name}, ${variant.name}`;
  if (altImage) {
    if (variant.images[1]) {
      altImage.src = variant.images[1];
      altImage.hidden = false;
    } else {
      altImage.hidden = true;
    }
  }
  $("[data-card-variant-name]", card).textContent = variant.name;
  $("[data-quick-add]", card).setAttribute("aria-label", `Add ${product.name}, ${variant.name}, to bag`);
  $$(".swatch", card).forEach((swatch) => {
    const index = Number(swatch.dataset.variantIndex);
    const item = product.variants[index];
    swatch.setAttribute("aria-pressed", String(index === selectedIndex));
    swatch.setAttribute("aria-label", `${item.name}${index === selectedIndex ? ", selected" : ""}`);
  });
}

function setCategory(category, { scroll = false } = {}) {
  state.category = categoryById.has(category) ? category : "all";
  renderProducts();
  if (scroll) {
    els.shop.scrollIntoView({ behavior: prefersReducedMotion.matches ? "auto" : "smooth", block: "start" });
    els.shop.focus({ preventScroll: true });
  }
}

/* Bag */
function loadBag() {
  try {
    const parsed = JSON.parse(storageGet(BAG_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({ id: Number(item.id), variant: Number(item.variant), qty: Math.min(MAX_QTY, Math.max(1, Number(item.qty) || 1)) }))
      .filter((item) => productById.get(item.id)?.variants[item.variant]);
  } catch {
    return [];
  }
}

function saveBag() {
  storageSet(BAG_KEY, JSON.stringify(state.bag));
}

function bagQuantity() {
  return state.bag.reduce((sum, item) => sum + item.qty, 0);
}

function bagSubtotal() {
  return state.bag.reduce((sum, item) => sum + productById.get(item.id).price * item.qty, 0);
}

function addToBag(productId, variantIndex, qty = 1) {
  const existing = state.bag.find((item) => item.id === productId && item.variant === variantIndex);
  if (existing) existing.qty = Math.min(MAX_QTY, existing.qty + qty);
  else state.bag.push({ id: productId, variant: variantIndex, qty: Math.min(MAX_QTY, qty) });
  saveBag();
  renderBag();
  els.bagCount.classList.remove("is-bumped");
  void els.bagCount.offsetWidth;
  els.bagCount.classList.add("is-bumped");
}

function updateBagItem(productId, variantIndex, qty) {
  const item = state.bag.find((entry) => entry.id === productId && entry.variant === variantIndex);
  if (!item) return;
  if (qty <= 0) state.bag = state.bag.filter((entry) => entry !== item);
  else item.qty = Math.min(MAX_QTY, qty);
  saveBag();
  renderBag();
}

function orderMessage(items) {
  const lines = items.map((item, index) => {
    const product = productById.get(item.id);
    const variant = product.variants[item.variant];
    return `${index + 1}. ${product.name} — Color: ${variant.name} — Qty: ${item.qty} — ${formatPrice(product.price * item.qty)}`;
  });
  const subtotal = items.reduce((sum, item) => sum + productById.get(item.id).price * item.qty, 0);
  return [`Hi Cavara, I'd like to order:`, ...lines, `Subtotal: ${formatPrice(subtotal)}`].join("\n");
}

function whatsappUrl(message) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

function renderBag() {
  const count = bagQuantity();
  els.bagCount.textContent = String(count);
  els.bagButton.setAttribute("aria-label", `Open bag, ${pluralize(count, "item")}`);
  els.bagCountMirror.textContent = String(count);
  els.bagMirror.setAttribute("aria-label", `Open bag, ${pluralize(count, "item")}`);
  els.bagSummary.textContent = count ? `${pluralize(count, "item")} · ${formatPrice(bagSubtotal())}` : "No items yet";
  els.bagEmpty.hidden = count > 0;
  els.bagFooter.hidden = count === 0;
  els.bagList.hidden = count === 0;
  els.bagSubtotal.textContent = formatPrice(bagSubtotal());
  els.bagWhatsapp.href = count ? whatsappUrl(orderMessage(state.bag)) : "#";

  els.bagList.innerHTML = state.bag.map((item) => {
    const product = productById.get(item.id);
    const variant = product.variants[item.variant];
    return `
      <li class="bag-item">
        <button class="bag-item-image" type="button" data-open-product="${product.id}" data-open-variant="${item.variant}" aria-label="View ${escapeHtml(product.name)}">
          <img src="${escapeHtml(variant.images[0])}" alt="" loading="lazy" width="168" height="210" />
        </button>
        <div>
          <h3>${escapeHtml(product.name)}</h3>
          <p class="bag-item-variant">${escapeHtml(variant.name)} · ${formatPrice(product.price)} each</p>
          <div class="bag-item-controls">
            <div class="quantity" role="group" aria-label="Quantity for ${escapeHtml(product.name)}">
              <button type="button" data-bag-qty="-1" data-bag-product="${product.id}" data-bag-variant="${item.variant}">
                <i class="fa-solid fa-minus" aria-hidden="true"></i><span class="sr-only">Decrease quantity</span>
              </button>
              <output aria-live="polite">${item.qty}</output>
              <button type="button" data-bag-qty="1" data-bag-product="${product.id}" data-bag-variant="${item.variant}" ${item.qty >= MAX_QTY ? "disabled" : ""}>
                <i class="fa-solid fa-plus" aria-hidden="true"></i><span class="sr-only">Increase quantity</span>
              </button>
            </div>
            <button class="bag-remove" type="button" data-bag-remove data-bag-product="${product.id}" data-bag-variant="${item.variant}">Remove</button>
          </div>
        </div>
        <p class="bag-item-price">${formatPrice(product.price * item.qty)}</p>
      </li>`;
  }).join("");
}

/* Dialog helpers */
function lockScroll() {
  document.body.classList.toggle("is-locked", els.productDialog.open || els.bagDialog.open);
}

function openModal(dialog) {
  dialog.classList.remove("is-closing");
  els.toast.hidden = true;
  if (!dialog.open) dialog.showModal();
  lockScroll();
}

function closeModal(dialog) {
  if (!dialog.open || dialog.classList.contains("is-closing")) return;
  const finish = () => {
    dialog.classList.remove("is-closing");
    dialog.close();
    lockScroll();
  };
  if (prefersReducedMotion.matches) {
    finish();
    return;
  }
  dialog.classList.add("is-closing");
  dialog.addEventListener("animationend", finish, { once: true });
  window.setTimeout(() => dialog.open && dialog.classList.contains("is-closing") && finish(), 260);
}

function closeOnBackdrop(dialog, close) {
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside || event.target === dialog) close();
  });
}

/* Product dialog */
function productUrl(product) {
  return `${location.pathname}?product=${encodeURIComponent(product.slug)}${location.hash}`;
}

function cleanUrl() {
  return `${location.pathname}${location.hash}`;
}

function openProduct(productId, { push = true, variantIndex } = {}) {
  const product = productById.get(productId);
  if (!product) return;
  if (Number.isInteger(variantIndex) && product.variants[variantIndex]) state.selectedVariant.set(product.id, variantIndex);
  const isSameProduct = state.dialog.productId === product.id && els.productDialog.open;
  state.dialog.productId = product.id;
  state.dialog.imageIndex = 0;
  if (!isSameProduct) state.dialog.quantity = 1;
  els.dialogFeedback.hidden = true;
  renderProductDialog();

  if (els.bagDialog.open) closeModal(els.bagDialog);
  openModal(els.productDialog);

  if (push && !isSameProduct) {
    if (state.dialog.pushed) history.replaceState({ product: product.slug }, "", productUrl(product));
    else history.pushState({ product: product.slug }, "", productUrl(product));
    state.dialog.pushed = true;
  }
  window.requestAnimationFrame(() => $("[data-close-product]").focus());
}

function hideProductDialog() {
  closeModal(els.productDialog);
  state.dialog.productId = null;
}

function requestCloseProduct() {
  if (!els.productDialog.open) return;
  if (state.dialog.pushed && history.state?.product) {
    history.back();
  } else {
    history.replaceState(null, "", cleanUrl());
    state.dialog.pushed = false;
    hideProductDialog();
  }
}

function renderDialogImage() {
  const product = productById.get(state.dialog.productId);
  const variant = getVariant(product);
  const images = variant.images;
  const imageIndex = Math.min(state.dialog.imageIndex, images.length - 1);
  els.dialogImage.src = images[imageIndex];
  els.dialogImage.alt = `${product.name}, ${variant.name}, image ${imageIndex + 1} of ${images.length}`;
  els.dialogImage.style.animation = "none";
  void els.dialogImage.offsetWidth;
  els.dialogImage.style.animation = "";
  els.dialogCount.textContent = `${imageIndex + 1} / ${images.length}`;
  els.dialogCount.hidden = images.length < 2;
  $$("[data-gallery-step]").forEach((button) => (button.hidden = images.length < 2));
  $$("[data-thumb-index]", els.dialogThumbs).forEach((thumb) => {
    thumb.setAttribute("aria-current", String(Number(thumb.dataset.thumbIndex) === imageIndex));
  });
}

function renderProductDialog() {
  const product = productById.get(state.dialog.productId);
  if (!product) return;
  const selectedIndex = state.selectedVariant.get(product.id) ?? 0;
  const variant = getVariant(product, selectedIndex);
  const category = categoryById.get(product.category);
  const qty = state.dialog.quantity;

  els.dialogCategory.textContent = category?.name ?? "";
  els.dialogTitle.textContent = product.name;
  els.dialogPrice.textContent = formatPrice(product.price);
  els.dialogSummary.textContent = product.summary;
  els.dialogVariantName.textContent = variant.name;
  els.dialogSwatches.innerHTML = product.variants.map((item, index) => swatchButton(product, item, index, selectedIndex, { size: "large" })).join("");
  els.dialogThumbs.innerHTML = variant.images.map(
    (image, index) => `
      <button class="thumb" type="button" data-thumb-index="${index}" aria-label="Show image ${index + 1} of ${variant.images.length}">
        <img src="${escapeHtml(image)}" alt="" loading="lazy" width="136" height="136" />
      </button>`
  ).join("");
  els.dialogThumbs.hidden = variant.images.length < 2;
  els.dialogDetails.innerHTML = (product.details ?? []).map((detail) => `<li>${escapeHtml(detail)}</li>`).join("");
  els.dialogNote.textContent = product.note ?? "";
  els.dialogNote.hidden = !product.note;
  els.dialogQtyValue.textContent = String(qty);
  $('[data-dialog-qty="-1"]').disabled = qty <= 1;
  $('[data-dialog-qty="1"]').disabled = qty >= MAX_QTY;
  els.dialogAddLabel.textContent = `Add to bag · ${formatPrice(product.price * qty)}`;
  els.dialogWhatsapp.href = whatsappUrl(singleOrderMessage(product, variant, qty));
  renderDialogImage();
}

function singleOrderMessage(product, variant, qty) {
  return `Hi Cavara, I want to order: ${product.name} - Color: ${variant.name} - Qty: ${qty} (${formatPrice(product.price * qty)})`;
}

function selectVariant(productId, variantIndex) {
  const product = productById.get(productId);
  if (!product?.variants[variantIndex]) return;
  state.selectedVariant.set(productId, variantIndex);
  updateCard(productId);
  if (state.page.productId === productId) updatePageVariant();
  if (state.dialog.productId === productId && els.productDialog.open) {
    state.dialog.imageIndex = 0;
    els.dialogFeedback.hidden = true;
    renderProductDialog();
    $(`[data-dialog-swatches] [data-variant-index="${variantIndex}"]`)?.focus();
  }
}

function stepGallery(step) {
  const product = productById.get(state.dialog.productId);
  if (!product) return;
  const total = getVariant(product).images.length;
  state.dialog.imageIndex = (state.dialog.imageIndex + step + total) % total;
  renderDialogImage();
}

/* Feedback */
let toastTimer;
function showToast(message, { actionLabel, action, inBag = false } = {}) {
  const toast = inBag && els.bagDialog.open ? els.bagToast : els.toast;
  window.clearTimeout(toastTimer);
  toast.innerHTML = `<span>${escapeHtml(message)}</span>${actionLabel ? `<button type="button">${escapeHtml(actionLabel)}</button>` : ""}`;
  toast.hidden = false;
  if (actionLabel) $("button", toast).addEventListener("click", () => {
    toast.hidden = true;
    action?.();
  });
  toastTimer = window.setTimeout(() => (toast.hidden = true), 4200);
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to a temporary selection below.
  }
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  } catch {
    return false;
  }
}

function showDialogFeedback(message, withBagAction = true) {
  els.dialogFeedback.innerHTML = `<span>${escapeHtml(message)}</span>${withBagAction ? '<button type="button" data-view-bag>View bag</button>' : ""}`;
  els.dialogFeedback.hidden = false;
}

function openBag() {
  if (els.productDialog.open) {
    if (state.dialog.pushed && history.state?.product) {
      history.replaceState(null, "", cleanUrl());
      state.dialog.pushed = false;
    }
    hideProductDialog();
  }
  renderBag();
  openModal(els.bagDialog);
  window.requestAnimationFrame(() => $("[data-close-bag]").focus());
}

/* Events */
function bindEvents() {
  document.addEventListener("click", async (event) => {
    const target = event.target.closest("button, a");
    if (!target) return;

    if (target.matches("[data-spot-toggle]")) {
      const open = target.getAttribute("aria-expanded") !== "true";
      closeSpots(target);
      setSpot(target, open);
      return;
    }
    if (target.matches("[data-carousel-step]")) {
      stepCarousel(Number(target.dataset.carouselStep));
      return;
    }
    if (target.matches("[data-load-more]")) {
      const firstHidden = $$(".product-card", els.productGrid)[STUDIO_PAGE_SIZE];
      state.studioExpanded = true;
      renderProducts();
      $("[data-open-product]:not([tabindex='-1'])", $$(".product-card", els.productGrid)[STUDIO_PAGE_SIZE] ?? firstHidden)?.focus({ preventScroll: true });
      return;
    }
    if (target.matches("[data-studio-step]")) {
      showSlide(state.slideshow.index + Number(target.dataset.studioStep));
      syncSlideshow();
      return;
    }
    if (target.matches("[data-studio-dot]")) {
      showSlide(Number(target.dataset.studioDot));
      syncSlideshow();
      return;
    }
    if (target.matches("[data-studio-pause]")) {
      state.slideshow.paused = !state.slideshow.paused;
      syncSlideshow();
      return;
    }
    if (target.matches("[data-open-product]") && !target.matches("[data-quick-view]")) {
      const variant = target.dataset.openVariant === undefined ? undefined : Number(target.dataset.openVariant);
      openProductPage(Number(target.dataset.openProduct), { variantIndex: variant });
      return;
    }
    if (target.matches("[data-dialog-page]")) {
      const id = state.dialog.productId;
      const pushed = state.dialog.pushed;
      hideProductDialog();
      openProductPage(id, { pushed });
      return;
    }
    if (target.matches("[data-page-home]")) {
      leaveProductPage();
      return;
    }
    if (target.matches("[data-page-category]")) {
      const category = target.dataset.pageCategory;
      leaveProductPage(() => setCategory(category, { scroll: true }));
      return;
    }
    if (target.matches("[data-page-qty]")) {
      state.page.quantity = Math.min(MAX_QTY, Math.max(1, state.page.quantity + Number(target.dataset.pageQty)));
      updatePageQuantity();
      return;
    }
    if (target.matches("[data-page-add]")) {
      const product = productById.get(state.page.productId);
      const variantIndex = state.selectedVariant.get(product.id) ?? 0;
      addToBag(product.id, variantIndex, state.page.quantity);
      showToast(`${pluralize(state.page.quantity, "item")} added · ${product.variants[variantIndex].name}`, { actionLabel: "View bag", action: openBag });
      return;
    }
    if (target.matches("[data-page-copy]")) {
      const copied = await copyText(target.dataset.pageCopy);
      showToast(copied ? "Link copied" : "Copy the link from your address bar");
      return;
    }
    if (target.matches("[data-page-tab]")) {
      selectPageTab(target.dataset.pageTab);
      return;
    }
    if (state.page.productId && target.matches('a[href^="#"]')) {
      leaveProductPage();
    }
    if (target.matches("[data-open-product]")) {
      const variant = target.dataset.openVariant === undefined ? undefined : Number(target.dataset.openVariant);
      openProduct(Number(target.dataset.openProduct), { variantIndex: variant });
      return;
    }
    if (target.matches("[data-variant-product]")) {
      selectVariant(Number(target.dataset.variantProduct), Number(target.dataset.variantIndex));
      return;
    }
    if (target.matches("[data-quick-add]")) {
      const product = productById.get(Number(target.dataset.quickAdd));
      const variantIndex = state.selectedVariant.get(product.id) ?? 0;
      addToBag(product.id, variantIndex, 1);
      target.classList.add("is-added");
      target.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i><span>Added</span>';
      window.setTimeout(() => {
        target.classList.remove("is-added");
        target.innerHTML = '<i class="fa-solid fa-bag-shopping" aria-hidden="true"></i><span>Add to bag</span>';
      }, 1400);
      showToast(`${product.name} added to your bag`, { actionLabel: "View bag", action: openBag });
      return;
    }
    if (target.matches("[data-shop-category]")) {
      if (state.page.productId) leaveProductPage();
      setCategory(target.dataset.shopCategory, { scroll: true });
      return;
    }
    if (target.matches("[data-filter]")) {
      setCategory(target.dataset.filter);
      return;
    }
    if (target.matches("[data-clear-filters]")) {
      state.category = "all";
      state.query = "";
      els.search.value = "";
      renderProducts();
      els.search.focus();
      return;
    }
    if (target.matches("[data-focus-search]")) {
      els.shop.scrollIntoView({ behavior: prefersReducedMotion.matches ? "auto" : "smooth", block: "start" });
      els.search.focus({ preventScroll: true });
      return;
    }
    if (target.matches("[data-open-bag], [data-view-bag]")) {
      openBag();
      return;
    }
    if (target.matches("[data-close-bag]")) {
      closeModal(els.bagDialog);
      return;
    }
    if (target.matches("[data-shop-from-bag]")) {
      closeModal(els.bagDialog);
      if (state.page.productId) leaveProductPage();
      setCategory("all", { scroll: true });
      return;
    }
    if (target.matches("[data-close-product]")) {
      requestCloseProduct();
      return;
    }
    if (target.matches("[data-gallery-step]")) {
      stepGallery(Number(target.dataset.galleryStep));
      return;
    }
    if (target.matches("[data-thumb-index]")) {
      state.dialog.imageIndex = Number(target.dataset.thumbIndex);
      renderDialogImage();
      return;
    }
    if (target.matches("[data-dialog-qty]")) {
      state.dialog.quantity = Math.min(MAX_QTY, Math.max(1, state.dialog.quantity + Number(target.dataset.dialogQty)));
      renderProductDialog();
      return;
    }
    if (target.matches("[data-dialog-add]")) {
      const product = productById.get(state.dialog.productId);
      const variantIndex = state.selectedVariant.get(product.id) ?? 0;
      addToBag(product.id, variantIndex, state.dialog.quantity);
      showDialogFeedback(`${pluralize(state.dialog.quantity, "item")} added · ${getVariant(product).name}`);
      return;
    }
    if (target.matches("[data-dialog-messenger]")) {
      const product = productById.get(state.dialog.productId);
      const copied = await copyText(singleOrderMessage(product, getVariant(product), state.dialog.quantity));
      showDialogFeedback(copied ? "Order copied. Paste it into Messenger." : "Messenger opened. Tell us the piece and colour you want.", false);
      return;
    }
    if (target.matches("[data-bag-qty]")) {
      const item = state.bag.find((entry) => entry.id === Number(target.dataset.bagProduct) && entry.variant === Number(target.dataset.bagVariant));
      if (item) updateBagItem(item.id, item.variant, item.qty + Number(target.dataset.bagQty));
      return;
    }
    if (target.matches("[data-bag-remove]")) {
      const product = productById.get(Number(target.dataset.bagProduct));
      updateBagItem(product.id, Number(target.dataset.bagVariant), 0);
      showToast(`${product.name} removed`, { inBag: true });
      if (!state.bag.length) $("[data-shop-from-bag]").focus();
      return;
    }
    if (target.matches("[data-clear-bag]")) {
      state.bag = [];
      saveBag();
      renderBag();
      $("[data-shop-from-bag]").focus();
      return;
    }
    if (target.matches("[data-bag-messenger]")) {
      const copied = await copyText(orderMessage(state.bag));
      showToast(copied ? "Order copied. Paste it into Messenger." : "Messenger opened. Please list your pieces there.", { inBag: true });
      return;
    }
    if (target.closest("#mobile-nav") && target.matches("a")) {
      setMobileMenu(false);
    }
  });

  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    renderProducts();
  });

  els.sort.addEventListener("change", () => {
    state.sort = els.sort.value;
    renderProducts();
  });

  els.paletteTrigger.addEventListener("click", () => setPaletteMenu(els.paletteMenu.hidden));
  els.paletteOptions.addEventListener("change", (event) => {
    if (event.target.name === "palette") applyPalette(event.target.value);
  });
  els.paletteOptions.addEventListener("keydown", (event) => {
    if (event.key === "Enter") setPaletteMenu(false, { restoreFocus: true });
  });

  document.addEventListener("click", (event) => {
    if (!els.paletteMenu.hidden && !event.target.closest("[data-palette-picker]")) setPaletteMenu(false);
    if (!els.mobileNav.hidden && !event.target.closest(".site-header")) setMobileMenu(false);
  });

  document.addEventListener("keydown", (event) => {
    const openSpot = $("[data-spot-toggle][aria-expanded='true']");
    if (event.key === "Escape" && openSpot) {
      setSpot(openSpot, false);
      openSpot.focus();
    } else if (event.key === "Escape" && !els.paletteMenu.hidden) {
      setPaletteMenu(false, { restoreFocus: true });
    } else if (event.key === "Escape" && !els.mobileNav.hidden) {
      setMobileMenu(false);
      els.menuToggle.focus();
    }
    const typing = event.target.matches?.("input, textarea, select");
    if (event.key === "/" && !typing && !els.productDialog.open && !els.bagDialog.open) {
      event.preventDefault();
      els.shop.scrollIntoView({ behavior: prefersReducedMotion.matches ? "auto" : "smooth", block: "start" });
      els.search.focus({ preventScroll: true });
    }
    if (els.productDialog.open && (event.key === "ArrowLeft" || event.key === "ArrowRight") && !event.target.matches?.(".swatch, input")) {
      stepGallery(event.key === "ArrowLeft" ? -1 : 1);
    }
  });

  els.menuToggle.addEventListener("click", () => setMobileMenu(els.mobileNav.hidden));

  const holdSlideshow = (hovered) => {
    state.slideshow.hovered = hovered;
    syncSlideshow();
  };
  els.studioHero.addEventListener("pointerenter", () => holdSlideshow(true));
  els.studioHero.addEventListener("pointerleave", () => holdSlideshow(els.studioHero.contains(document.activeElement)));
  els.studioHero.addEventListener("focusin", () => holdSlideshow(true));
  els.studioHero.addEventListener("focusout", (event) => {
    if (!els.studioHero.contains(event.relatedTarget)) holdSlideshow(false);
  });
  document.addEventListener("visibilitychange", syncSlideshow);
  els.studioSlides.addEventListener("click", (event) => {
    const media = event.target.closest(".studio-slide-media");
    if (!media) return;
    const rect = media.getBoundingClientRect();
    showSlide(state.slideshow.index + (event.clientX < rect.left + rect.width / 2 ? -1 : 1));
    syncSlideshow();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".studio-spot")) closeSpots();
  });
  window.addEventListener("scroll", queueHeader, { passive: true });
  window.addEventListener("scroll", queueFancy, { passive: true });
  window.addEventListener("resize", queueFancy, { passive: true });
  window.addEventListener("scroll", queuePageBar, { passive: true });
  window.addEventListener("resize", queuePageBar, { passive: true });
  setupCarouselDrag();
  setupPageZoom();
  els.pdp.addEventListener("keydown", (event) => {
    const tab = event.target.closest?.("[data-page-tab]");
    if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = $$("[data-page-tab]", els.pdp);
    const index = tabs.indexOf(tab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    selectPageTab(tabs[next].dataset.pageTab, { focus: true });
  });

  els.productDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    requestCloseProduct();
  });
  els.bagDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeModal(els.bagDialog);
  });
  closeOnBackdrop(els.productDialog, requestCloseProduct);
  closeOnBackdrop(els.bagDialog, () => closeModal(els.bagDialog));
  els.productDialog.addEventListener("close", lockScroll);
  els.bagDialog.addEventListener("close", lockScroll);

  window.addEventListener("popstate", () => {
    const slug = new URLSearchParams(location.search).get("product");
    const product = slug ? productBySlug.get(slug) : null;
    if (product) {
      openProductPage(product.id, { push: false, pushed: Boolean(history.state?.product) });
      return;
    }
    if (state.page.productId) closeProductPage();
    state.dialog.pushed = false;
    hideProductDialog();
  });

  window.addEventListener("storage", (event) => {
    if (event.key === BAG_KEY) {
      state.bag = loadBag();
      renderBag();
    }
    if (event.key === PALETTE_KEY && event.newValue) applyPalette(event.newValue, { persist: false });
  });

  document.addEventListener(
    "error",
    (event) => {
      if (event.target instanceof HTMLImageElement) {
        event.target
          .closest(".product-media, .product-dialog-media, .studio-slide-media, .studio-category-media, .studio-promo-media, .studio-lookbook-media, .studio-carousel-media, .pdp-shot")
          ?.classList.add("media-failed");
      }
    },
    true
  );
}

function setMobileMenu(open) {
  els.mobileNav.hidden = !open;
  els.menuToggle.setAttribute("aria-expanded", String(open));
  els.menuToggle.innerHTML = `<i class="fa-solid ${open ? "fa-xmark" : "fa-bars"}" aria-hidden="true"></i><span class="sr-only">${open ? "Close menu" : "Open menu"}</span>`;
}

function initFromUrl() {
  const slug = new URLSearchParams(location.search).get("product");
  const product = slug ? productBySlug.get(slug) : null;
  if (product) {
    openProductPage(product.id, { push: false });
  } else if (slug) {
    history.replaceState(null, "", cleanUrl());
  }
}

function init() {
  renderPaletteOptions();
  applyPalette(document.documentElement.dataset.palette || storageGet(PALETTE_KEY) || "teal", { persist: false });
  state.slideshow.paused = prefersReducedMotion.matches;
  renderFooterCollections();
  renderStudio();
  renderFilters();
  renderProducts();
  renderBag();
  bindEvents();
  $$("main > .section > .container-wide > .section-head, .shop-toolbar, .story-media, .story-copy, .ordering-head, .steps li, .footer-panel").forEach((element, index) => {
    element.dataset.reveal = "";
    if (element.matches(".steps li")) element.style.setProperty("--reveal-delay", `${(index % 3) * 110}ms`);
  });
  setupReveals();
  setupCursor();
  syncSlideshow();
  queueFancy();
  updateHeader();
  window.requestAnimationFrame(updateCarouselButtons);
  $("[data-year]").textContent = String(new Date().getFullYear());
  initFromUrl();
}

init();
