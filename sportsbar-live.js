const SHEET_ID = "1Oj95Oe9hMRYjgDzuuYewC_ti51nh0FO91WRUNjMvspk";
const LOCAL_API_BASE = "http://127.0.0.1:8787";

const bookingsTableBody = document.getElementById("bookingsTableBody");
const bookingsCount = document.getElementById("bookingsCount");
const availabilityCards = document.getElementById("availabilityCards");
const availabilityCount = document.getElementById("availabilityCount");
const apiStatus = document.getElementById("apiStatus");
const bookingForm = document.getElementById("bookingForm");
const bookingMessage = document.getElementById("bookingMessage");
const bookingDate = document.getElementById("bookingDate");
let localApiOnline = false;

const resourceTypeLabels = {
  table: "Bord",
  bowling: "Bowling",
  shuffleboard: "Shuffleboard",
  dart: "Dart",
  billiard: "Biljard",
  karaoke: "Karaoke",
};

function setDefaultDate() {
  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  bookingDate.value = iso;
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

function parseGvizTable(table) {
  const columns = table.cols.map((column, index) => {
    return column.label || column.id || `col_${index}`;
  });

  return table.rows.map((row) => {
    const item = {};
    columns.forEach((column, index) => {
      const cell = row.c[index];
      item[column] = cell ? (cell.f ?? cell.v ?? "") : "";
    });
    return item;
  });
}

function loadSheet(sheetName, query) {
  return new Promise((resolve, reject) => {
    const callbackName = `gvizCallback_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const url = new URL(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`);
    url.searchParams.set("sheet", sheetName);
    url.searchParams.set("tq", query);
    url.searchParams.set("tqx", `responseHandler:${callbackName}`);

    const script = document.createElement("script");

    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout loading ${sheetName}`));
    }, 8000);

    function cleanup() {
      window.clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (response) => {
      cleanup();
      if (response.status === "error") {
        reject(new Error(response.errors?.[0]?.detailed_message || `Query failed for ${sheetName}`));
        return;
      }
      resolve(parseGvizTable(response.table));
    };

    script.onerror = () => {
      cleanup();
      reject(new Error(`Script error while loading ${sheetName}`));
    };

    script.src = url.toString();
    document.body.appendChild(script);
  });
}

async function fetchFromLocalApi() {
  const [bookingsResponse, availabilityResponse] = await Promise.all([
    fetch(`${LOCAL_API_BASE}/bookings?limit=12`),
    fetch(`${LOCAL_API_BASE}/availability?limit=18`),
  ]);

  if (!bookingsResponse.ok || !availabilityResponse.ok) {
    throw new Error("Demo-API svarade inte som väntat");
  }

  const bookingsPayload = await bookingsResponse.json();
  const availabilityPayload = await availabilityResponse.json();
  renderBookings(
    bookingsPayload.items.map((item) => ({
      customer_name: item.customer_name,
      booking_type: item.booking_type,
      date: item.date,
      start_time: item.start_time,
      notes: item.notes,
    })),
  );
  renderAvailability(
    availabilityPayload.items.map((item) => ({
      resource_id: item.resource_id,
      date: item.date,
      start_time: item.start_time,
      end_time: item.end_time,
      booking_type: item.booking_type,
      party_size_max: item.party_size_max,
      resource_name: item.resource_name,
    })),
  );
}

async function fetchFromSheetFallback() {
  const [bookings, resources, slots] = await Promise.all([
    loadSheet("Bookings", "select C, F, I, J, L, K where K = 'confirmed' order by I asc, J asc limit 12"),
    loadSheet("Resources", "select A, B, C, D where E = 'TRUE'"),
    loadSheet("Slots", "select B, C, D, E, F, G, H where F = 'available' order by C asc, D asc limit 18"),
  ]);

  const resourceMap = new Map(
    resources.map((resource) => [resource.resource_id, resource.name]),
  );

  renderBookings(bookings);
  renderAvailability(slots, resourceMap);
}

async function fetchBookingsAndAvailability() {
  try {
    if (localApiOnline) {
      await fetchFromLocalApi();
      return;
    }
    await fetchFromSheetFallback();
  } catch (error) {
    bookingsCount.textContent = "Kunde inte läsa arket";
    availabilityCount.textContent = "Kunde inte läsa arket";
    bookingsTableBody.innerHTML = `<tr><td colspan="5" class="table-empty">Google Sheetet går inte att läsa från browsern just nu. Öppna arket i samma browser-session eller dela sheetet som läsbart för demo.</td></tr>`;
    availabilityCards.innerHTML = `<div class="availability-empty">${escapeHtml(error.message)}</div>`;
  }
}

function renderBookings(bookings) {
  bookingsCount.textContent = `${bookings.length} bokningar`;

  if (!bookings.length) {
    bookingsTableBody.innerHTML = '<tr><td colspan="5" class="table-empty">Inga bokningar hittades ännu.</td></tr>';
    return;
  }

  bookingsTableBody.innerHTML = bookings.map((booking) => {
    return `<tr>
      <td><strong>${escapeHtml(booking.customer_name)}</strong></td>
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
        <span>${escapeHtml(formatDate(slot.date))} • max ${escapeHtml(slot.party_size_max)} pers</span>
      </div>
      <div class="availability-time">${escapeHtml(slot.start_time)}-${escapeHtml(slot.end_time)}</div>
    </article>`;
  }).join("");
}

async function checkLocalApi() {
  try {
    const response = await fetch(`${LOCAL_API_BASE}/health`);
    if (!response.ok) {
      throw new Error("API offline");
    }
    const payload = await response.json();
    apiStatus.textContent = `Demo-API online • ${payload.sheet}`;
    apiStatus.className = "api-status api-status-online";
    bookingMessage.textContent = "Demo-API hittat. Du kan skapa bokningar direkt mot arket.";
    bookingMessage.className = "booking-message";
    localApiOnline = true;
    return true;
  } catch (error) {
    apiStatus.textContent = "Demo-API offline • sidan är read-only";
    apiStatus.className = "api-status api-status-offline";
    bookingMessage.textContent = "Starta det lokala API:t med kommandot nedan för att skriva till Google Sheetet.";
    bookingMessage.className = "booking-message";
    localApiOnline = false;
    return false;
  }
}

async function submitBooking(event) {
  event.preventDefault();

  const formData = new FormData(bookingForm);
  const payload = Object.fromEntries(formData.entries());
  payload.party_size = Number(payload.party_size);

  bookingMessage.textContent = "Skapar bokning...";
  bookingMessage.className = "booking-message";

  try {
    const response = await fetch(`${LOCAL_API_BASE}/book`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Bokningen misslyckades");
    }

    bookingMessage.textContent = `Bokning skapad: ${result.resource_name} ${result.date} ${result.start_time} för ${result.customer_name}.`;
    bookingMessage.className = "booking-message is-success";
    await fetchBookingsAndAvailability();
  } catch (error) {
    bookingMessage.textContent = error.message;
    bookingMessage.className = "booking-message is-error";
  }
}

setDefaultDate();
bookingForm.addEventListener("submit", submitBooking);
checkLocalApi().then(fetchBookingsAndAvailability);
