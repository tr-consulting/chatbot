const PUBLISHED_SHEET_ID = "2PACX-1vReA5CqHPI2DyCHXX1v77_VeWIMsCCq66v-uw0Cdkq7lSyYEXSMRDHmY8TEMruKcdZFAJ_vT5mqIn2S";
const PUBLISHED_GIDS = {
  Resources: "1396278763",
  Slots: "492074727",
  Bookings: "2097606553",
};

const bookingsTableBody = document.getElementById("bookingsTableBody");
const bookingsCount = document.getElementById("bookingsCount");
const availabilityCards = document.getElementById("availabilityCards");
const availabilityCount = document.getElementById("availabilityCount");
const apiStatus = document.getElementById("apiStatus");
const refreshBookingsButton = document.getElementById("refreshBookingsButton");
const bookingsToggleButton = document.getElementById("bookingsToggleButton");
const bookingsPanelContent = document.getElementById("bookingsPanelContent");

const resourceTypeLabels = {
  table: "Bord",
  bowling: "Bowling",
  shuffleboard: "Shuffleboard",
  dart: "Dart",
  billiard: "Biljard",
  karaoke: "Karaoke",
};

function syncMobileBookingsPanel() {
  if (!bookingsToggleButton || !bookingsPanelContent) {
    return;
  }

  const isMobile = window.innerWidth <= 640;
  const isOpen = bookingsToggleButton.getAttribute("aria-expanded") === "true";

  if (!isMobile) {
    bookingsPanelContent.classList.add("is-open");
    bookingsToggleButton.setAttribute("aria-expanded", "false");
    return;
  }

  bookingsPanelContent.classList.toggle("is-open", isOpen);
}

function formatDate(dateValue) {
  const date = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }
  return new Intl.DateTimeFormat("sv-SE", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(current);
      if (row.some((cell) => cell !== "")) {
        rows.push(row);
      }
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((cell) => cell !== "")) {
    rows.push(row);
  }

  return rows;
}

async function loadPublishedCsv(sheetName) {
  const gid = PUBLISHED_GIDS[sheetName];
  const url = `https://docs.google.com/spreadsheets/d/e/${PUBLISHED_SHEET_ID}/pub?gid=${gid}&single=true&output=csv`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Kunde inte läsa publicerad CSV för ${sheetName}`);
  }

  const csv = await response.text();
  const rows = parseCsv(csv);
  if (!rows.length) {
    return [];
  }

  const [header, ...body] = rows;
  return body.map((row) => {
    const item = {};
    header.forEach((column, index) => {
      item[column] = row[index] ?? "";
    });
    return item;
  });
}

function setRefreshingState(isRefreshing) {
  if (!refreshBookingsButton) {
    return;
  }

  refreshBookingsButton.disabled = isRefreshing;
  refreshBookingsButton.textContent = isRefreshing ? "Uppdaterar..." : "Uppdatera listan";
}

async function fetchLiveData() {
  const [bookings, resources, slots] = await Promise.all([
    loadPublishedCsv("Bookings"),
    loadPublishedCsv("Resources"),
    loadPublishedCsv("Slots"),
  ]);

  const resourceMap = new Map(resources.map((resource) => [resource.resource_id, resource.name]));
  const confirmedBookings = bookings
    .filter((booking) => booking.status === "confirmed")
    .sort((left, right) => `${left.date} ${left.start_time}`.localeCompare(`${right.date} ${right.start_time}`))
    .slice(0, 12)
    .map((booking) => ({
      customer_name: booking.customer_name,
      party_size: booking.party_size,
      booking_type: booking.booking_type,
      date: booking.date,
      start_time: booking.start_time,
      notes: booking.notes,
    }));

  const availableSlots = slots
    .filter((slot) => slot.status === "available")
    .sort((left, right) => `${left.date} ${left.start_time}`.localeCompare(`${right.date} ${right.start_time}`))
    .slice(0, 18)
    .map((slot) => ({
      resource_id: slot.resource_id,
      booking_type: slot.booking_type,
      date: slot.date,
      start_time: slot.start_time,
      end_time: slot.end_time,
      party_size_max: slot.party_size_max,
    }));

  renderBookings(confirmedBookings);
  renderAvailability(availableSlots, resourceMap);
  apiStatus.textContent = "Google Sheet live";
  apiStatus.className = "api-status api-status-online";
}

async function fetchBookingsAndAvailability() {
  setRefreshingState(true);

  try {
    await fetchLiveData();
  } catch (error) {
    bookingsCount.textContent = "Kunde inte läsa arket";
    availabilityCount.textContent = "Kunde inte läsa arket";
    bookingsTableBody.innerHTML = `<tr><td colspan="6" class="table-empty">Google Sheetet går inte att läsa från browsern just nu. Kontrollera publiceringen eller prova att ladda om sidan.</td></tr>`;
    availabilityCards.innerHTML = `<div class="availability-empty">${escapeHtml(error.message)}</div>`;
    apiStatus.textContent = "Kunde inte läsa live-data";
    apiStatus.className = "api-status api-status-offline";
  } finally {
    setRefreshingState(false);
  }
}

function renderBookings(bookings) {
  bookingsCount.textContent = `${bookings.length} bokningar`;

  if (!bookings.length) {
    bookingsTableBody.innerHTML = '<tr><td colspan="6" class="table-empty">Inga bokningar hittades ännu.</td></tr>';
    return;
  }

  bookingsTableBody.innerHTML = bookings.map((booking) => {
    return `<tr>
      <td><strong>${escapeHtml(booking.customer_name)}</strong></td>
      <td>${escapeHtml(booking.party_size || "-")} pers</td>
      <td>${escapeHtml(resourceTypeLabels[booking.booking_type] || booking.booking_type)}</td>
      <td>${escapeHtml(formatDate(booking.date))}</td>
      <td>${escapeHtml(booking.start_time)}</td>
      <td>${escapeHtml(booking.notes || "-")}</td>
    </tr>`;
  }).join("");
}

function renderAvailability(slots, resourceMap = null) {
  availabilityCount.textContent = `${slots.length} lediga slots`;

  if (!slots.length) {
    availabilityCards.innerHTML = '<div class="availability-empty">Inga lediga tider hittades.</div>';
    return;
  }

  availabilityCards.innerHTML = slots.map((slot) => {
    const resourceName = slot.resource_name || (resourceMap ? resourceMap.get(slot.resource_id) : slot.resource_id) || slot.resource_id;
    const typeLabel = resourceTypeLabels[slot.booking_type] || slot.booking_type;
    return `<article class="availability-card">
      <span class="availability-badge">${escapeHtml(typeLabel)}</span>
      <div class="availability-meta">
        <strong>${escapeHtml(resourceName)}</strong>
        <span>${escapeHtml(formatDate(slot.date))} • upp till ${escapeHtml(slot.party_size_max)} gäster</span>
      </div>
      <div class="availability-time">${escapeHtml(slot.start_time)}-${escapeHtml(slot.end_time)}</div>
    </article>`;
  }).join("");
}
fetchBookingsAndAvailability();

refreshBookingsButton?.addEventListener("click", fetchBookingsAndAvailability);

bookingsToggleButton?.addEventListener("click", () => {
  const isOpen = bookingsToggleButton.getAttribute("aria-expanded") === "true";
  bookingsToggleButton.setAttribute("aria-expanded", String(!isOpen));
  syncMobileBookingsPanel();
});

window.addEventListener("resize", syncMobileBookingsPanel);
syncMobileBookingsPanel();
