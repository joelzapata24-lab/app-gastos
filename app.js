// ─── CONFIG ─────────────────────────────────────────────────────────────────
console.log("Gastos App v2.2 - Diagnostic mode");

// Atrapa errores globales para debug en móviles
window.onerror = function(msg, url, line, col, error) {
  alert("Error Detectado: " + msg + "\nEn: " + url + ":" + line + ":" + col);
  return false;
};

// Reemplazá estos valores con los de tu proyecto Supabase
const SUPABASE_URL = window.ENV_SUPABASE_URL || 'https://dgpbsruvrccowtvobayx.supabase.co';
const SUPABASE_KEY = window.ENV_SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRncGJzcnV2cmNjb3d0dm9iYXl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4MjUxMDQsImV4cCI6MjEwMDQwMTEwNH0.AlkSjLg5-xE6WKr9hzcYik1krDB1RlYVg2SAHdsvfmo';
// ────────────────────────────────────────────────────────────────────────────

let sb, currentUser;

/**
 * Helper para ejecutar promesas con reintentos y tiempo de espera.
 * Ideal para redes móviles inestables.
 */
async function sbWithTimeout(promiseFn, timeoutMs = 12000, retries = 1) {
  for (let i = 0; i <= retries; i++) {
    try {
      const promise = typeof promiseFn === 'function' ? promiseFn() : promiseFn;
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Tiempo de espera agotado')), timeoutMs)
      );
      return await Promise.race([promise, timeout]);
    } catch (err) {
      if (i === retries) throw err;
      console.warn("Reintentando petición...");
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// Verificar sesión al volver a la app
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && sb) {
    sb.auth.getSession().then(({ data }) => {
      if (!data.session) {
        console.warn("Sesión perdida al volver");
        setSyncStatus('err');
      } else {
        setSyncStatus('ok');
      }
    });
  }
});

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
let allGastos = [];
let editGastoId = null;
let allRecurrentes = [];
let dolarHoy = 1200; 
let prefMoneda = localStorage.getItem('prefMoneda') || 'ARS';
let tarjetasCfg = [
  { tarjeta: 'Visa', dia_cierre: 15, dia_vencimiento: 25 },
  { tarjeta: 'Mastercard', dia_cierre: 20, dia_vencimiento: 30 },
  { tarjeta: 'Amex', dia_cierre: 10, dia_vencimiento: 20 }
];
let usuarios = [];
let categorias = [
  { id: 'cat-1', nombre: 'Supermercado', color: '#1D9E75' },
  { id: 'cat-2', nombre: 'Servicios', color: '#185FA5' },
  { id: 'cat-3', nombre: 'Insumos Brasería', color: '#D85A30' }, // Personalizado
  { id: 'cat-4', nombre: 'Logística/Delivery', color: '#BA7517' }, // Personalizado
  { id: 'cat-5', nombre: 'Salud', color: '#7F77DD' },
  { id: 'cat-6', nombre: 'Tecnología y Software', color: '#D4537E' },
  { id: 'cat-7', nombre: 'Deudas', color: '#185FA5' },
  { id: 'cat-8', nombre: 'Otros', color: '#639922' }
];

/**
 * Normaliza la entrada de números para soportar coma decimal
 * y evitar errores de overflow.
 */
function parseInputFloat(val) {
  if (!val) return 0;
  const clean = val.toString().replace(',', '.');
  const num = parseFloat(clean);
  if (isNaN(num)) return 0;
  // Límite de seguridad para evitar overflow en DB (ej: 1 billón)
  if (num > 999999999999) return 999999999999;
  return num;
}

let dashMonth = new Date(); dashMonth.setDate(1);
let isAppLoaded = false; // Evita doble inicialización

// ─── INIT ────────────────────────────────────────────────────────────────────
async function init() {
  console.log("Iniciando aplicación...");
  try {
    if (typeof supabase === 'undefined') {
      alert("Error: No se pudo cargar la librería de Supabase.");
      return;
    }

    sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    
    const { data } = await sb.auth.getSession();
    const session = data?.session;
    
    if (session && !isAppLoaded) {
      currentUser = session.user;
      isAppLoaded = true;
      await showApp();
    } else if (!session) {
      showAuth();
    }

    sb.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth event:', event);
      if (event === 'SIGNED_IN' && session && !isAppLoaded) {
        currentUser = session.user;
        isAppLoaded = true;
        await showApp();
      } else if (event === 'SIGNED_OUT') {
        isAppLoaded = false;
        showAuth();
      }
    });
  } catch (e) {
    alert('Error crítico de inicio: ' + e.message);
    showAuth();
  }
}

function showAuth() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app-header').style.display = 'none';
  document.getElementById('app-content').style.display = 'none';
  document.getElementById('app-nav').style.display = 'none';
}

async function showApp() {
  const panels = {
    'auth-screen': 'none',
    'app-header': 'flex',
    'app-content': 'block',
    'app-nav': 'flex'
  };

  for (const [id, display] of Object.entries(panels)) {
    const el = document.getElementById(id);
    if (el) el.style.display = display;
  }

  if (!currentUser) return;

  const meta = currentUser.user_metadata;
  const name = meta?.name || currentUser.email.split('@')[0];

  const elUser = document.getElementById('header-user');
  if (elUser) elUser.textContent = `Hola, ${name}`;
  
  const elEmail = document.getElementById('cfg-email');
  if (elEmail) elEmail.textContent = currentUser.email;
  
  const elName = document.getElementById('cfg-name');
  if (elName) elName.textContent = name;

  setSyncStatus('ok');
  
  // Pedir permiso para notificaciones (solo si existe la API)
  if (window.Notification && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // Carga paralela para mayor velocidad
  await Promise.all([
    loadCategorias(),
    loadUsuarios(),
    loadGastos(),
    loadDeudas(),
    loadRecurrentes(),
    loadTarjetasConfig(),
    loadIngresos(),
    loadGoals(),
    loadAhorros()
  ]);
  
  document.getElementById('pref-moneda').value = prefMoneda;
  fetchDolar();
  
  // Activar Realtime
  subscribeRealtime();
  
  initForm();
  renderDash();
  updateNotifStatus();
}

function requestNotificationPermission() {
  if (!("Notification" in window)) {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS) {
      alert("Para recibir notificaciones en iPhone/iPad:\n1. Toca el botón 'Compartir' abajo (cuadrado con flecha).\n2. Elegí 'Añadir a la pantalla de inicio'.\n3. Abrí la aplicación desde tu pantalla de inicio e intentalo de nuevo.");
    } else {
      alert("Este navegador no soporta notificaciones de escritorio.");
    }
    return;
  }

  const handlePermission = (permission) => {
    updateNotifStatus();
    if (permission === "granted") {
      showToast("¡Notificaciones activadas! ✓");
      new Notification("Gastos Familiares", { 
        body: "Las notificaciones están configuradas correctamente.",
        icon: 'https://cdn-icons-png.flaticon.com/512/2454/2454282.png'
      });
    } else if (permission === "denied") {
      showToast("Permiso de notificación denegado. Habilitalo en los ajustes del sitio.", "err");
    }
  };

  // Safari antiguo usa callback, navegadores modernos usan Promise. Soportamos ambos.
  try {
    const promise = Notification.requestPermission(handlePermission);
    if (promise && promise.then) {
      promise.then(handlePermission);
    }
  } catch (e) {
    Notification.requestPermission(handlePermission);
  }
}

function updateNotifStatus() {
  const el = document.getElementById('notif-status');
  if (!el) return;
  
  if (!window.Notification) {
    el.textContent = "Navegador no compatible.";
  } else if (Notification.permission === "granted") {
    el.textContent = "✓ Notificaciones activadas.";
    el.style.color = "var(--green)";
  } else if (Notification.permission === "denied") {
    el.textContent = "✕ Notificaciones bloqueadas en este navegador.";
    el.style.color = "var(--red)";
  } else {
    el.textContent = "Estado: Pendiente de activar.";
  }
}

// ─── AUTH ────────────────────────────────────────────────────────────────────
function showAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t, i) => t.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'register')));
  document.getElementById('login-form').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('register-form').style.display = tab === 'register' ? 'block' : 'none';
  clearAuthMessages();
}

function clearAuthMessages() {
  document.getElementById('auth-error').style.display = 'none';
  document.getElementById('auth-msg').style.display = 'none';
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg; el.style.display = 'block';
  document.getElementById('auth-msg').style.display = 'none';
}

function showAuthMsg(msg) {
  const el = document.getElementById('auth-msg');
  el.textContent = msg; el.style.display = 'block';
  document.getElementById('auth-error').style.display = 'none';
}

async function login() {
  const email = document.getElementById('l-email').value.trim();
  const pass = document.getElementById('l-pass').value;
  if (!email || !pass) { showAuthError('Completá todos los campos'); return; }
  const btn = document.getElementById('login-btn');
  if (btn) { btn.innerHTML = '<span class="spinner"></span> Ingresando...'; btn.classList.add('btn-loading'); }
  try {
    const { error } = await sbWithTimeout(() => sb.auth.signInWithPassword({ email, password: pass }));
    if (error) throw error;
  } catch (error) {
    showAuthError(error.message === 'Invalid login credentials' ? 'Email o contraseña incorrectos' : error.message);
  } finally {
    if (btn) { btn.innerHTML = 'Ingresar'; btn.classList.remove('btn-loading'); }
  }
}

async function register() {
  const name = document.getElementById('r-name').value.trim();
  const email = document.getElementById('r-email').value.trim();
  const pass = document.getElementById('r-pass').value;
  if (!name || !email || !pass) { showAuthError('Completá todos los campos'); return; }
  if (pass.length < 6) { showAuthError('La contraseña debe tener al menos 6 caracteres'); return; }
  const btn = document.getElementById('register-btn');
  btn.innerHTML = '<span class="spinner"></span> Creando cuenta...'; btn.classList.add('btn-loading');
  
  try {
    const { data, error } = await sbWithTimeout(() => sb.auth.signUp({
      email,
      password: pass,
      options: { data: { name } }
    }));

    if (error) throw error;

    if (data?.user) {
      await sbWithTimeout(() => sb.from('profiles').insert([{
        id: data.user.id,
        name: name,
        email: email
      }]));
    }
    showAuthMsg('¡Cuenta creada! Revisá tu email para confirmar y luego ingresá.');
  } catch (error) {
    showAuthError(error.message);
  } finally {
    btn.innerHTML = 'Crear cuenta'; btn.classList.remove('btn-loading');
  }
}

async function forgotPass() {
  const email = prompt('Ingresá tu email para recuperar la contraseña:');
  if (!email) return;
  const { error } = await sb.auth.resetPasswordForEmail(email);
  if (error) showAuthError(error.message);
  else showAuthMsg('Te enviamos un email para restablecer tu contraseña.');
}

async function logout() {
  stopPolling();
  await sb.auth.signOut();
  allGastos = [];
  currentUser = null;
}

// ─── SYNC STATUS ─────────────────────────────────────────────────────────────
function setSyncStatus(status) {
  const dot = document.getElementById('sync-dot');
  const lbl = document.getElementById('sync-label');
  if (!dot || !lbl) {
    console.warn('Sync status elements not found');
    return;
  }
  if (status === 'ok') { dot.className = 'sync-dot'; lbl.textContent = 'Sincronizado'; }
  else if (status === 'sync') { dot.className = 'sync-dot warn'; lbl.textContent = 'Guardando...'; }
  else { dot.className = 'sync-dot warn'; lbl.textContent = 'Sin conexión'; }
}

// ─── TOAST ───────────────────────────────────────────────────────────────────
function showToast(msg, type = 'ok') {
  const t = document.getElementById('toast');
  t.className = 'toast ' + type; t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._t); t._t = setTimeout(() => t.style.display = 'none', 3000);
}

// ─── SUPABASE DATA ───────────────────────────────────────────────────────────
async function loadCategorias() {
  const { data, error } = await sb.from('categorias').select('*').order('nombre');
  if (data && data.length) {
    categorias = data;
    // Asegurar que 'Deudas' esté presente si no viene de la DB
    if (!categorias.find(c => c.nombre === 'Deudas')) {
      categorias.push({ id: 'cat-deu', nombre: 'Deudas', color: '#185FA5' });
    }
  }
}

async function fetchDolar() {
  try {
    const res = await fetch('https://dolarapi.com/v1/dolares/blue');
    const data = await res.json();
    if (data && data.compra) {
      dolarHoy = data.compra;
      renderDash();
      renderDeudas();
    }
  } catch (e) { console.error('Error fetching dolar', e); }
}

async function loadTarjetasConfig() {
  const { data, error } = await sb.from('tarjetas_config').select('*');
  if (data && data.length) tarjetasCfg = data;
}

async function saveTarjetaConfig(tarjeta, dia_cierre) {
  try {
    const { error } = await sbWithTimeout(() => sb.from('tarjetas_config').upsert({ 
      tarjeta, 
      dia_cierre: parseInt(dia_cierre),
      user_id: currentUser.id 
    }, { onConflict: 'tarjeta' }));
    
    if (error) throw error;
    
    await loadTarjetasConfig();
    renderDeudas();
    showToast('Configuración de tarjeta guardada ✓');
  } catch (error) {
    console.error(error);
    showToast('Error al guardar config de tarjeta: ' + (error.message || 'Error de conexión'), 'err');
  }
}

async function loadUsuarios() {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .order('name');

  if (data) usuarios = data;
}

async function loadGastos() {
  const { data, error } = await sb
    .from('gastos')
    .select('*')
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false });

  if (data) { 
    allGastos = data; 
    renderDash(); 
    renderEvolutionChart();
  }
}

async function saveGastoToDB(gasto) {
  setSyncStatus('sync');
  try {
    const { data, error } = await sbWithTimeout(() => sb.from('gastos').insert([gasto]).select('id').single());
    if (error) { 
      setSyncStatus('err'); 
      return { data: null, error }; 
    }
    setSyncStatus('ok');
    return { data, error: null };
  } catch (e) {
    setSyncStatus('err');
    return { data: null, error: { message: e.message || 'Tiempo de espera agotado' } };
  }
}

async function updateGastoDB(id, gasto) {
  setSyncStatus('sync');
  try {
    const { error } = await sbWithTimeout(() => sb.from('gastos').update(gasto).eq('id', id));
    if (error) { 
      setSyncStatus('err'); 
      return { data: null, error }; 
    }
    setSyncStatus('ok');
    return { data: [gasto], error: null };
  } catch (e) {
    setSyncStatus('err');
    return { data: null, error: { message: e.message || 'Tiempo de espera agotado' } };
  }
}

async function deleteGastoDB(id) {
  setSyncStatus('sync');
  try {
    const { error } = await sbWithTimeout(() => sb.from('gastos').delete().eq('id', id));
    setSyncStatus(error ? 'err' : 'ok');
    return { error };
  } catch (e) {
    setSyncStatus('err');
    return { error: { message: e.message || 'Tiempo de espera agotado' } };
  }
}

async function saveCategoriaDB(cat) {
  const { data, error } = await sb.from('categorias').insert([cat]).select();
  return { data, error };
}

async function deleteCategoriaDB(id) {
  const { error } = await sb.from('categorias').delete().eq('id', id);
  return { error };
}

let realtimeChannel = null;
function subscribeRealtime() {
  if (realtimeChannel) sb.removeChannel(realtimeChannel);
  
  realtimeChannel = sb.channel('db-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'gastos' }, async (payload) => {
      // Recargar datos solo cuando sea necesario
      const { data } = await sb
        .from('gastos')
        .select('*')
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false });

      if (data) {
        allGastos = data;
        renderDash();
        
        // Notificación si el cambio es de otra persona
        if (payload.eventType === 'INSERT' && payload.new.user_id !== currentUser.id) {
          const partner = payload.new.persona || 'Tu pareja';
          const monto = payload.new.moneda === 'USD' ? 'U$D ' + payload.new.monto : '$' + payload.new.monto;
          
          showToast(`${partner} cargó un gasto de ${monto}`, 'info');
          
          if (Notification.permission === 'granted') {
            new Notification('💰 Nuevo Gasto Familiar', {
              body: `${partner} cargó: ${payload.new.descripcion || payload.new.categoria} por ${monto}`,
              icon: 'https://cdn-icons-png.flaticon.com/512/2454/2454282.png'
            });
          }
        }
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ingresos' }, async (payload) => {
      await loadIngresos();
      renderBalance();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ahorros' }, async (payload) => {
      await loadAhorros();
      renderAhorros();
    })
    .subscribe();
}

function stopPolling() {
  if (realtimeChannel) { sb.removeChannel(realtimeChannel); realtimeChannel = null; }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function fmt(n) { 
  const val = prefMoneda === 'USD' ? (n / dolarHoy) : n;
  return (prefMoneda === 'USD' ? 'U$D ' : '$') + parseFloat(val || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); 
}
function fdate(d) { return (d || '').split('-').reverse().join('/'); }
function catColor(nombre) { 
  if (nombre === 'Deudas') return '#185FA5';
  return (categorias.find(c => c.nombre === nombre) || { color: '#888' }).color; 
}
const EMOJIS = { 'Supermercado': '🛒', 'Servicios': '💡', 'Transporte': '🚗', 'Salud': '💊', 'Educación': '📚', 'Entretenimiento': '🎬', 'Ropa': '👕', 'Deudas': '💳', 'Otros': '📦' };
function catEmoji(n) { return EMOJIS[n] || '📦'; }
function personaBadge(p) {
  const currentProfile = usuarios.find(u => u.id === currentUser.id);
  const miNombre = currentProfile?.name || '';

  let cls = 'b-ambos';

  if (p === miNombre) {
    cls = 'b-yo';
  } else if (p !== 'Ambos' && p !== '') {
    cls = 'b-senora';
  }

  return `<span class="badge ${cls}">${p || 'Ambos'}</span>`;
}

function fmtGasto(n, moneda) {
  let finalVal = n;
  if (moneda === 'USD' && prefMoneda === 'ARS') finalVal = n * dolarHoy;
  if (moneda === 'ARS' && prefMoneda === 'USD') finalVal = n / dolarHoy;
  
  const symbol = prefMoneda === 'USD' ? 'U$D ' : '$';
  const res = symbol + parseFloat(finalVal || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  if (moneda !== prefMoneda) {
    const origSymbol = moneda === 'USD' ? 'U$D ' : '$';
    const orig = origSymbol + parseFloat(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${res} <span style="font-size:10px;font-weight:400;color:var(--text3);display:block">Original: ${orig}</span>`;
  }
  return res;
}
const fmtDeuda = fmtGasto;


// ─── TABS ────────────────────────────────────────────────────────────────────
function switchTab(t) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const tabs = ['home', 'nuevo', 'hist', 'bal', 'goals', 'rep', 'deu', 'rec', 'met', 'cfg', 'mas'];
  document.querySelectorAll('.nav-btn').forEach((b, i) => b.classList.toggle('active', b.id === 'nb-' + t));
  document.getElementById('p-' + t).classList.add('active');
  document.getElementById('app-content').scrollTop = 0;
  
  // Auto scroll navigation to keep active button visible
  const activeBtn = document.getElementById('nb-' + t);
  if (activeBtn) activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

  // 👇 NUEVO: Si cambiamos a la pestaña "nuevo", limpiamos el estado de edición
  if (t === 'nuevo') {
    clearForm();  // Limpia el formulario y resetea editGastoId
  }
  
  if (t === 'home') renderDash();
  if (t === 'nuevo') initForm();
  if (t === 'hist') { initHist(); loadHistorial(); }
  if (t === 'bal') renderBalance();
  if (t === 'aho') renderAhorros();
  if (t === 'goals') renderGoals();
  if (t === 'deu') renderDeudas();
  if (t === 'rec') renderRecurrentes();
  if (t === 'met') renderMetrics();
  if (t === 'cfg') renderConfig();
  if (t === 'rep') initRep();
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

function renderDashDeudas() {
  const activas = allDeudas.filter(d => getCuotasPagasDeuda(d) < (d.cuotas_total||1));
  if (activas.length === 0) {
    const el = document.getElementById('dash-deudas');
    if (el) el.style.display = 'none';
    return;
  }
  const el = document.getElementById('dash-deudas');
  if (el) {
    el.style.display = 'block';
    const tarjetas = getTarjetas();
    const porTarjeta = {};
    tarjetas.forEach(t => { porTarjeta[t] = { ars:0, usd:0 }; });
    activas.forEach(d => {
      if (porTarjeta[d.tarjeta]) {
        if (d.moneda === 'USD') porTarjeta[d.tarjeta].usd += parseFloat(d.monto_cuota||0);
        else porTarjeta[d.tarjeta].ars += parseFloat(d.monto_cuota||0);
      } else {
        // If the card is not in the list, dynamically add it
        porTarjeta[d.tarjeta] = { ars:0, usd:0 };
        if (d.moneda === 'USD') porTarjeta[d.tarjeta].usd = parseFloat(d.monto_cuota||0);
        else porTarjeta[d.tarjeta].ars = parseFloat(d.monto_cuota||0);
        if(!tarjetas.includes(d.tarjeta)) tarjetas.push(d.tarjeta);
      }
    });
    el.innerHTML = '<div class="card-title">Cuotas este mes</div>' +
      tarjetas.filter(t => porTarjeta[t] && (porTarjeta[t].ars > 0 || porTarjeta[t].usd > 0)).map(t => {
        const cfg = tarjetasCfg ? tarjetasCfg.find(c => c.tarjeta === t) : null;
        const color = (cfg && cfg.color) ? cfg.color : (TARJETA_COLORS[t] || '#666');
        let montos = [];
        if (porTarjeta[t].ars > 0) montos.push('$'+porTarjeta[t].ars.toLocaleString('es-AR',{minimumFractionDigits:2}));
        if (porTarjeta[t].usd > 0) montos.push('U$D '+porTarjeta[t].usd.toLocaleString('es-AR',{minimumFractionDigits:2}));
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
          <span class="tarjeta-badge" style="background:${color};color:white">${t}</span>
          <span style="font-size:13px;font-weight:600">${montos.join(' + ')}/mes</span>
        </div>`;
      }).join('') +
      `<button class="btn btn-sm" onclick="switchTab('deu')" style="margin-top:10px;width:100%">Ver detalle →</button>`;
  }
}

    function changeMonth(d) { dashMonth.setMonth(dashMonth.getMonth() + d); renderDash(); }

function getMonthGastos() {
  const y = dashMonth.getFullYear(), m = String(dashMonth.getMonth() + 1).padStart(2, '0');
  return allGastos.filter(g => g.fecha && g.fecha.startsWith(`${y}-${m}`));
}

function renderDash() {
  const mg = getMonthGastos();
  renderDashDeudas();
  renderEvolutionChart();
  document.getElementById('dash-month').textContent = `${MESES[dashMonth.getMonth()]} ${dashMonth.getFullYear()}`;
  
  const getMontoARS = (g) => {
    const m = parseFloat(g.monto || 0);
    return g.moneda === 'USD' ? m * dolarHoy : m;
  };

  const ym = `${dashMonth.getFullYear()}-${String(dashMonth.getMonth() + 1).padStart(2, '0')}`;
  const totalGastos = mg.reduce((s, g) => s + getMontoARS(g), 0);
  const totalCuotas = getCuotasMes(ym);
  const total = totalGastos + totalCuotas;

  const currentProfile = usuarios.find(u => u.id === currentUser?.id);
  const miNombre = currentProfile?.name || '';
  const parejaProfile = usuarios.find(u => u.id !== currentUser?.id);
  const parejaNombre = parejaProfile?.name || 'Pareja';

  const yo = mg
    .filter(g => g.persona === miNombre)
    .reduce((s, g) => s + getMontoARS(g), 0);

  const pareja = mg
    .filter(g => g.persona !== miNombre && g.persona !== 'Ambos')
    .reduce((s, g) => s + getMontoARS(g), 0);

  const totalIngresos = allIngresos
    .filter(i => i.fecha && i.fecha.startsWith(ym))
    .reduce((s, i) => s + getMontoARS(i), 0);
  const balanceNeto = totalIngresos - total;

  document.getElementById('dash-metrics').innerHTML = `
  <div class="metric" style="grid-column:1/-1; background:var(--surface2)">
    <div class="metric-label">Balance Neto (Sobrante)</div>
    <div class="metric-value ${balanceNeto >= 0 ? 'g' : 'r'}">${fmt(balanceNeto)}</div>
    <div style="font-size:10px; color:var(--text3); margin-top:4px">Ingresos: ${fmt(totalIngresos)} | Gastos: ${fmt(total)}</div>
  </div>
  <div class="metric" style="grid-column:1/-1">
    <div class="metric-label">Total del mes (Gastos + Pendientes)</div>
    <div class="metric-value">${fmt(total)}</div>
  </div>
  <div class="metric">
    <div class="metric-label">Gastos del mes</div>
    <div class="metric-value">${fmt(totalGastos)}</div>
  </div>
  <div class="metric">
    <div class="metric-label">Cuotas pendientes</div>
    <div class="metric-value" style="color:var(--text3)">${fmt(totalCuotas)}</div>
  </div>
  <div class="metric">
    <div class="metric-label">${miNombre || 'Yo'}</div>
    <div class="metric-value r">${fmt(yo)}</div>
  </div>
  <div class="metric">
    <div class="metric-label">${parejaNombre}</div>
    <div class="metric-value r">${fmt(pareja)}</div>
  </div>
  `;
  const catMap = {};
  mg.forEach(g => { 
    const montoARS = getMontoARS(g);
    catMap[g.categoria] = (catMap[g.categoria] || 0) + montoARS; 
  });

  const sorted = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  
  document.getElementById('dash-cats').innerHTML = sorted.length
    ? sorted.map(([cat, val]) => {
        const cInfo = categorias.find(c => c.nombre === cat) || {};
        const ppto = parseFloat(cInfo.presupuesto || 0);
        const pct = ppto > 0 ? Math.round((val / ppto) * 100) : 0;
        const barColor = (ppto > 0 && val > ppto) ? 'var(--red)' : catColor(cat);
        
        return `<div class="cat-row">
        <div class="cat-row-head">
          <span class="cat-name"><span class="cat-dot" style="background:${catColor(cat)}"></span>${cat}</span>
          <span class="cat-val">${fmt(val)} ${ppto > 0 ? `<span style="color:var(--text3);font-size:11px;font-weight:400">/ ${fmt(ppto)}</span>` : ''}</span>
        </div>
        <div class="bar-bg">
          <div class="bar-fill" style="width:${ppto > 0 ? Math.min(pct, 100) : (val / (sorted[0][1] || 1) * 100)}%;background:${barColor}"></div>
        </div>
        ${ppto > 0 ? `<div style="font-size:10px;text-align:right;margin-top:2px;color:${val > ppto ? 'var(--red)' : 'var(--text2)'}">${pct}% del presupuesto</div>` : ''}
      </div>`;
    }).join('')
    : '<div class="empty"><div class="empty-icon">📊</div>Sin gastos en este mes</div>';

  const ctxDonut = document.getElementById('donutChart');
  if (ctxDonut) {
    if (window.donutChartInstance) window.donutChartInstance.destroy();
    
    const labels = sorted.map(x => x[0]);
    const data = sorted.map(x => x[1]);
    const bgColors = labels.map(cat => catColor(cat));
    
    if (typeof Chart !== 'undefined') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        window.donutChartInstance = new Chart(ctxDonut, {
          type: 'doughnut',
          data: {
            labels: labels,
            datasets: [{
              data: data,
              backgroundColor: bgColors,
              borderWidth: isDark ? 2 : 1,
              borderColor: isDark ? '#1a1a18' : '#ffffff'
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false }
            },
            cutout: '70%'
          }
        });
    }
  }

  const recent = mg.slice(0, 5);
  document.getElementById('dash-recent').innerHTML = recent.length
    ? recent.map(g => `<div class="tx-item">
    <div class="tx-dot" style="background:${catColor(g.categoria)}33">${catEmoji(g.categoria)}</div>
    <div class="tx-info">
      <div class="tx-desc">${formatTags(g.descripcion || g.categoria)}</div>
      <div class="tx-meta">${g.categoria} · ${personaBadge(g.persona)}${g.notas ? `<br><span style="font-size:10px">${formatTags(g.notas)}</span>` : ''}</div>
    </div>
    <div class="tx-right">
      <div class="tx-amount">${fmtGasto(g.monto, g.moneda)}</div>
      <div class="tx-date">${fdate(g.fecha)}</div>
    </div>

  </div>`).join('')
    : '<div class="empty"><div class="empty-icon">🧾</div>Sin gastos recientes</div>';
}

// ─── ADJUNTOS/COMPROBANTES ───────────────────────────────────────────────────
let adjuntosTemp = []; // Almacena archivos seleccionados temporalmente

function getFileIcon(tipo) {
  if (tipo.startsWith('image/')) return '📷';
  if (tipo === 'application/pdf') return '📄';
  return '📎';
}

function updateAdjuntoPreview() {
  const input = document.getElementById('f-adjunto');
  const preview = document.getElementById('f-adjunto-preview');
  
  if (!input || !preview) return;
  
  if (input.files.length === 0 && adjuntosTemp.length === 0) {
    preview.style.display = 'none';
    return;
  }
  
  let html = '<div class="adjunto-preview">';
  
  // Archivos nuevos (del input)
  if (input.files.length > 0) {
    for (let file of input.files) {
      const icon = getFileIcon(file.type);
      const size = (file.size / 1024).toFixed(1);
      html += `
        <div class="adjunto-item">
          <div class="adjunto-icon">${icon}</div>
          <div class="adjunto-name" title="${file.name}">${file.name}</div>
          <span style="font-size:10px;color:var(--text3)">(${size}KB)</span>
          <button type="button" class="adjunto-remove" onclick="removeNewFile('${file.name}')" title="Eliminar">✕</button>
        </div>
      `;
    }
  }
  
  // Archivos existentes (adjuntosTemp)
  if (adjuntosTemp.length > 0) {
    for (let adj of adjuntosTemp) {
      const icon = getFileIcon(adj.tipo);
      const size = (adj.tamano / 1024).toFixed(1);
      html += `
        <div class="adjunto-item" style="opacity:0.6">
          <div class="adjunto-icon">${icon}</div>
          <div class="adjunto-name" title="${adj.nombre}">${adj.nombre}</div>
          <span style="font-size:10px;color:var(--text3)">(${size}KB)</span>
          <button type="button" class="adjunto-remove" onclick="removeExistingFile('${adj.id}')" title="Eliminar">✕</button>
        </div>
      `;
    }
  }
  
  html += '</div>';
  preview.innerHTML = html;
  preview.style.display = 'block';
}

function removeNewFile(fileName) {
  const input = document.getElementById('f-adjunto');
  const dataTransfer = new DataTransfer();
  
  for (let i = 0; i < input.files.length; i++) {
    if (input.files[i].name !== fileName) {
      dataTransfer.items.add(input.files[i]);
    }
  }
  
  input.files = dataTransfer.files;
  updateAdjuntoPreview();
}

function removeExistingFile(adjId) {
  adjuntosTemp = adjuntosTemp.filter(a => a.id !== adjId);
  updateAdjuntoPreview();
}

async function uploadAdjunto(file, gastoId) {
  try {
    const fileName = `${Date.now()}_${file.name}`.replace(/[^\w\-\.]/g, '_');
    const path = `${currentUser.id}/${gastoId}/${fileName}`;
    
    setSyncStatus('sync');
    
    const { error } = await sb.storage
      .from('comprobantes')
      .upload(path, file, { upsert: false });
    
    if (error) throw error;
    
    return {
      id: path,
      nombre: file.name,
      path,
      tipo: file.type,
      tamano: file.size,
      fecha: new Date().toISOString()
    };
  } catch (e) {
    console.error('Error subiendo archivo:', e);
    throw e;
  }
}

async function deleteAdjunto(path) {
  try {
    setSyncStatus('sync');
    
    const { error } = await sb.storage
      .from('comprobantes')
      .remove([path]);
    
    if (error) throw error;
    
    return true;
  } catch (e) {
    console.error('Error eliminando archivo:', e);
    throw e;
  }
}

async function downloadAdjunto(path, nombre) {
  try {
    const { data, error } = await sb.storage.from('comprobantes').download(path);
    if (error) {
      console.error('Error descargando adjunto:', error);
      showToast(error.message || 'No se puede descargar este archivo', 'err');
      return;
    }

    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre || path.split('/').pop();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    console.error('Error al descargar adjunto:', e);
    showToast('Error al descargar', 'err');
  }
}

async function viewAdjunto(path, tipo) {
  try {
    const { data, error } = await sb.storage.from('comprobantes').download(path);
    if (error) {
      console.error('Error viendo adjunto:', error);
      showToast(error.message || 'No se puede ver este archivo', 'err');
      return;
    }

    const url = URL.createObjectURL(data);
    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };

    const content = document.createElement('div');
    content.className = 'lightbox-content';
    // Tamaño fijo para que tanto imagen como PDF ocupen el mismo espacio
    content.style.width = '90vw';
    content.style.height = '90vh';

    if (tipo.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = url;
      img.style.maxWidth = '100%';
      img.style.maxHeight = '100%';
      img.style.objectFit = 'contain';
      content.appendChild(img);
    } else if (tipo === 'application/pdf') {
      const embed = document.createElement('embed');
      embed.src = url;
      embed.type = 'application/pdf';
      embed.style.width = '100%';
      embed.style.height = '100%';
      content.appendChild(embed);
    } else {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.textContent = 'Abrir archivo en nueva pestaña';
      content.appendChild(link);
    }

    const cleanup = () => {
      URL.revokeObjectURL(url);
      overlay.remove();
    };

    const closeBtn = document.createElement('button');
    closeBtn.className = 'lightbox-close';
    closeBtn.innerHTML = '✕';
    closeBtn.onclick = cleanup;
    content.appendChild(closeBtn);

    overlay.appendChild(content);
    document.body.appendChild(overlay);
    overlay.onclick = (e) => {
      if (e.target === overlay) cleanup();
    };
  } catch (e) {
    console.error('Error al ver adjunto:', e);
    showToast('Error al ver archivo', 'err');
  }
}

function toggleAdjuntosPanel(panelId) {
  const panel = document.getElementById(panelId);
  if (panel) {
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
  }
}

async function deleteAdjuntoFromGasto(gastoId, adjuntoId) {
  if (!confirm('¿Eliminar este comprobante?')) return;
  
  try {
    const gasto = allGastos.find(g => g.id === gastoId);
    if (!gasto) return;
    
    // Eliminar del storage
    await deleteAdjunto(adjuntoId);
    
    // Actualizar gasto en BD
    const adjuntosActualizados = (gasto.adjuntos || []).filter(a => a.id !== adjuntoId);
    await updateGastoDB(gastoId, { adjuntos: adjuntosActualizados });
    
    // Actualizar en memoria
    gasto.adjuntos = adjuntosActualizados;
    
    showToast('Comprobante eliminado ✓');
    loadHistorial();
    // Reabrimos el panel del mismo gasto para que el usuario pueda
    // seguir eliminando otros adjuntos sin tener que presionar el clip nuevamente.
    const panelId = 'panel-' + gastoId;
    const panel = document.getElementById(panelId);
    if (panel) panel.style.display = 'flex';
  } catch (e) {
    console.error('Error:', e);
    showToast('Error al eliminar comprobante', 'err');
  }
}

async function agregarAdjuntoAlGasto(gastoId) {
  const gasto = allGastos.find(g => g.id === gastoId);
  if (!gasto) return;
  
  // Crear input file temporal
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.pdf';
  input.onchange = async (e) => {
    const files = e.target.files;
    if (files.length === 0) return;
    
    try {
      const adjuntosExistentes = gasto.adjuntos || [];
      const adjuntosNuevos = [];
      
      for (let file of files) {
        const adjunto = await uploadAdjunto(file, gastoId);
        adjuntosNuevos.push(adjunto);
      }
      
      const adjuntosActualizados = [...adjuntosExistentes, ...adjuntosNuevos];
      await updateGastoDB(gastoId, { adjuntos: adjuntosActualizados });
      
      gasto.adjuntos = adjuntosActualizados;
      
      showToast(`${adjuntosNuevos.length} archivo(s) agregado(s) ✓`);
      loadHistorial();
    } catch (e) {
      console.error('Error:', e);
      showToast('Error al subir archivo', 'err');
    }
  };
  
  input.click();
}

// ─── NUEVO GASTO ─────────────────────────────────────────────────────────────
function initForm() {
  const now = new Date();
  document.getElementById('f-fecha').value = now.toISOString().split('T')[0];
  
  // Inicializar valores y construir dropdowns visuales (single-select)
  const fmon = document.getElementById('f-moneda'); if (fmon) fmon.value = prefMoneda;
  const fmonLbl = document.getElementById('f-moneda-label'); if (fmonLbl) fmonLbl.textContent = prefMoneda;

  const fcat = document.getElementById('f-cat'); if (fcat) fcat.value = '';
  const fcatLbl = document.getElementById('f-cat-label'); if (fcatLbl) fcatLbl.textContent = 'Seleccione';

  const fper = document.getElementById('f-persona'); if (fper) fper.value = '';
  const fperLbl = document.getElementById('f-persona-label'); if (fperLbl) fperLbl.textContent = 'Seleccione';

  buildGastoDropdowns();

  const currentProfile = usuarios.find(u => u.id === currentUser.id);
  if (currentProfile && fper) {
    fper.value = currentProfile.name;
    if (fperLbl) fperLbl.textContent = currentProfile.name;
  }
  
  // Inicializar listener para input de archivos
  const adjuntoInput = document.getElementById('f-adjunto');
  if (adjuntoInput) {
    adjuntoInput.addEventListener('change', updateAdjuntoPreview);
  }
}

const BTN_LABEL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20,6 9,17 4,12"/></svg> Guardar gasto';
function resetSaveBtn() {
  const btn = document.getElementById('save-btn');
  btn.innerHTML = BTN_LABEL;
  btn.classList.remove('btn-loading');
}

async function saveGasto() {
  const fecha = document.getElementById('f-fecha').value;
  let montoRaw = document.getElementById('f-monto').value;
  
  // Limpieza para móviles: comas por puntos y quitar basura
  montoRaw = montoRaw.replace(',', '.').replace(/[^0-9.]/g, '');
  
  const monto = parseFloat(montoRaw);
  const moneda = document.getElementById('f-moneda').value;
  const cat = document.getElementById('f-cat').value;
  const persona = document.getElementById('f-persona').value;
  const desc = document.getElementById('f-desc').value.trim();
  const notas = document.getElementById('f-notas').value.trim();

  if (!fecha) { showToast('Ingresá la fecha', 'err'); return; }
  if (!montoRaw || isNaN(monto) || monto <= 0) {
    const mEl = document.getElementById('f-monto');
    if (mEl) {
      mEl.classList.add('error');
      void mEl.offsetWidth;
      mEl.classList.add('shake');
      mEl.addEventListener('animationend', function _onend() { mEl.classList.remove('shake'); mEl.removeEventListener('animationend', _onend); });
      setTimeout(() => { mEl.classList.remove('error'); }, 1400);
      try { mEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(e) {}
    }
    showToast('Ingresá un monto válido', 'err');
    return;
  }

  if (!cat) {
    // Visual highlight + shake en el trigger de categoría
    const trg = document.getElementById('f-cat-trigger');
    if (trg) {
      trg.classList.add('error');
      // trigger reflow then add shake to restart animation reliably
      void trg.offsetWidth;
      trg.classList.add('shake');
      // limpiar clases después de la animación
      trg.addEventListener('animationend', function _onend() {
        trg.classList.remove('shake');
        trg.removeEventListener('animationend', _onend);
      });
      // eliminar estado de error luego de un tiempo
      setTimeout(() => { trg.classList.remove('error'); }, 1400);
      try { trg.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(e) {}
    }
    showToast('Seleccioná una categoría', 'err');
    return;
  }
  if (!desc) {
    const dEl = document.getElementById('f-desc');
    if (dEl) {
      dEl.classList.add('error');
      void dEl.offsetWidth;
      dEl.classList.add('shake');
      dEl.addEventListener('animationend', function _onend2() { dEl.classList.remove('shake'); dEl.removeEventListener('animationend', _onend2); });
      setTimeout(() => { dEl.classList.remove('error'); }, 1400);
      try { dEl.focus(); } catch(e) {}
    }
    showToast('Ingresá una descripción', 'err');
    return;
  }

  const btn = document.getElementById('save-btn');
  btn.innerHTML = '<span class="spinner"></span>'; btn.classList.add('btn-loading');

  try {
    // Redondeo estricto para evitar error de overflow en Supabase
    const montoFinal = Number(monto.toFixed(2));
    if (montoFinal > 99999999) { throw new Error('El monto es demasiado alto'); }

    if (editGastoId) {
      const gastoSB = { fecha, monto: montoFinal, moneda, categoria: cat, persona, descripcion: desc, notas };
      const { error } = await updateGastoDB(editGastoId, gastoSB);
      if (error) {
        showToast('Error al actualizar: ' + error.message, 'err');
      } else {
        const index = allGastos.findIndex(g => g.id === editGastoId);
        if (index > -1) {
          allGastos[index] = { ...allGastos[index], ...gastoSB };
        }
        
        // Subir adjuntos nuevos si existen
        const adjuntoInput = document.getElementById('f-adjunto');
        if (adjuntoInput && adjuntoInput.files.length > 0) {
          btn.innerHTML = '<span class="spinner"></span> Subiendo archivos...';
          const gasto = allGastos[index];
          const adjuntosActuales = gasto.adjuntos || [];
          const adjuntosSubidos = [];
          
          for (let file of adjuntoInput.files) {
            try {
              const adjunto = await uploadAdjunto(file, editGastoId);
              adjuntosSubidos.push(adjunto);
            } catch (err) {
              console.error('Error subiendo archivo:', err);
              showToast(`Error subiendo ${file.name}`, 'err');
            }
          }
          
          // Actualizar gasto con adjuntos nuevos
          if (adjuntosSubidos.length > 0) {
            const adjuntosFinales = [...adjuntosActuales, ...adjuntosSubidos];
            await updateGastoDB(editGastoId, { adjuntos: adjuntosFinales });
            gasto.adjuntos = adjuntosFinales;
          }
        }
        
        showToast('Gasto actualizado ✓');
        clearForm();
        renderDash();
        switchTab('hist');
      }
    } else {
      const id_temp = 'tmp_' + Date.now();
      const gasto = { id: id_temp, fecha, monto: montoFinal, moneda, categoria: cat, persona, descripcion: desc, notas, user_id: currentUser.id, user_email: currentUser.email, adjuntos: [] };
      allGastos.unshift(gasto);
      renderDash();

      const { id: _drop, ...gastoSB } = gasto;
      const { data, error } = await saveGastoToDB(gastoSB);

      if (error) {
        allGastos = allGastos.filter(g => g.id !== id_temp);
        renderDash();
        showToast('Error: ' + error.message, 'err');
      } else {
        const gastoInsertado = data || {};
        const gastoIndex = allGastos.findIndex(g => g.id === id_temp);
        if (gastoIndex > -1) {
          allGastos[gastoIndex] = { ...allGastos[gastoIndex], ...gastoInsertado };
        }

        const gastoGuardado = gastoIndex > -1 ? allGastos[gastoIndex] : gastoInsertado;
        const adjuntoInput = document.getElementById('f-adjunto');
        if (adjuntoInput && adjuntoInput.files.length > 0 && gastoGuardado?.id) {
          btn.innerHTML = '<span class="spinner"></span> Subiendo archivos...';
          const adjuntosSubidos = [];
          for (let file of adjuntoInput.files) {
            try {
              const adjunto = await uploadAdjunto(file, gastoGuardado.id);
              adjuntosSubidos.push(adjunto);
            } catch (err) {
              console.error('Error subiendo archivo:', err);
              showToast(`Error subiendo ${file.name}`, 'err');
            }
          }
          if (adjuntosSubidos.length > 0) {
            await updateGastoDB(gastoGuardado.id, { adjuntos: adjuntosSubidos });
            if (gastoIndex > -1) {
              allGastos[gastoIndex].adjuntos = adjuntosSubidos;
            }
          }
        }

        showToast('Gasto guardado ✓');
        clearForm();
        document.getElementById('f-monto').focus();
      }
    }
  } catch (e) {
    showToast(e.message || 'Error inesperado', 'err');
  } finally {
    resetSaveBtn();
  }
}

function clearForm() {
  document.getElementById('f-monto').value = '';
  document.getElementById('f-desc').value = '';
  document.getElementById('f-notas').value = '';
  
  // Limpiar adjuntos
  const adjuntoInput = document.getElementById('f-adjunto');
  if (adjuntoInput) adjuntoInput.value = '';
  adjuntosTemp = [];
  const preview = document.getElementById('f-adjunto-preview');
  if (preview) preview.style.display = 'none';
  
  editGastoId = null;
  const btn = document.getElementById('save-btn');
  if(btn) btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20,6 9,17 4,12" /></svg> Guardar gasto`;
}

//function editarGasto(id) {
//  const g = allGastos.find(x => x.id === id);
//  if (!g) return;
//  
//  switchTab('nuevo'); // Se llama primero para que initForm() genere los combos y defaults
//  
//  editGastoId = id;
//  document.getElementById('f-fecha').value = g.fecha || '';
//  document.getElementById('f-monto').value = g.monto || '';
//  document.getElementById('f-moneda').value = g.moneda || 'ARS';
//  document.getElementById('f-cat').value = g.categoria || '';
//  document.getElementById('f-persona').value = g.persona || '';
//  document.getElementById('f-desc').value = g.descripcion || '';
//  document.getElementById('f-notas').value = g.notas || '';
//  
//  const btn = document.getElementById('save-btn');
//  if(btn) btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Actualizar gasto`;
//}

// Reemplazá la función editarGasto completa con esta versión:

function editarGasto(id) {
  const g = allGastos.find(x => x.id === id);
  if (!g) return;
  
  // Primero cambiamos de pestaña (esto NO debe ejecutar initForm automáticamente)
  // En lugar de switchTab que llama a initForm, cambiamos manualmente
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('p-nuevo').classList.add('active');
  document.getElementById('nb-nuevo').classList.add('active');
  document.getElementById('app-content').scrollTop = 0;
  
  // Ahora sí, asignamos los valores del gasto a los campos (sin initForm de por medio)
  document.getElementById('f-fecha').value = g.fecha || '';
  document.getElementById('f-monto').value = g.monto || '';

  // Si los elementos son selects nativos (no reemplazados), mantenemos compatibilidad.
  const fmon = document.getElementById('f-moneda');
  if (fmon && fmon.tagName === 'SELECT') {
    fmon.value = g.moneda || 'ARS';
  } else if (fmon) {
    fmon.value = g.moneda || 'ARS';
    const lbl = document.getElementById('f-moneda-label'); if (lbl) lbl.textContent = fmon.value || 'ARS';
  }

  // Categoría
  const fcat = document.getElementById('f-cat');
  if (fcat && fcat.tagName === 'SELECT') {
    if (fcat.options.length === 0) fcat.innerHTML = categorias.map(c => `<option value="${c.nombre}">${c.nombre}</option>`).join('');
    fcat.value = g.categoria || '';
  } else if (fcat) {
    fcat.value = g.categoria || '';
    const lbl = document.getElementById('f-cat-label'); if (lbl) lbl.textContent = fcat.value || 'Seleccione';
  }

  // Persona
  const fper = document.getElementById('f-persona');
  if (fper && fper.tagName === 'SELECT') {
    if (fper.options.length === 0) fper.innerHTML = usuarios.map(u => `<option value="${u.name}">${u.name}</option>`).join('') + '<option value="Ambos">Ambos</option>';
    fper.value = g.persona || '';
  } else if (fper) {
    fper.value = g.persona || '';
    const lbl = document.getElementById('f-persona-label'); if (lbl) lbl.textContent = fper.value || 'Seleccione';
  }

  document.getElementById('f-desc').value = g.descripcion || '';
  document.getElementById('f-notas').value = g.notas || '';
  
  editGastoId = id;
  
  const btn = document.getElementById('save-btn');
  if(btn) btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Actualizar gasto`;
}

// ─── HISTORIAL ───────────────────────────────────────────────────────────────
// ── MULTISELECT STATE ──
let msCatSel = new Set();
let msPerSel = new Set();
let msInitDone = false;

function toggleMs(id, event) {
  if (event) event.stopPropagation();
  const el = document.getElementById(id);
  const isOpen = el.style.display !== 'none';
  
  // Cerramos otros dropdowns
  document.querySelectorAll('.ms-dropdown').forEach(d => {
    if (d.id !== id) d.style.display = 'none';
  });
  
  // Si vamos a abrir un dropdown relacionado con el formulario de gasto,
  // asegurarnos de reconstruir su contenido para que el check refleje
  // la selección actual.
  if (!isOpen) {
    // Reconstruir solo los dropdowns del gasto si existen
    if (id.startsWith('f-')) buildGastoDropdowns();
  }

  el.style.display = isOpen ? 'none' : 'block';
}

// Listener global optimizado para evitar cierres de teclado en móviles
document.addEventListener('click', e => {
  if (!e.target.closest('.ms-wrap')) {
    const drops = document.querySelectorAll('.ms-dropdown');
    let anyOpen = false;
    drops.forEach(d => { if(d.style.display !== 'none') anyOpen = true; });
    
    if (anyOpen) {
      drops.forEach(d => {
        if (d.style.display !== 'none') d.style.display = 'none';
      });
    }
  }
});

function buildMsCat() {
  const items = categorias.slice().sort((a,b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })).map(c => c.nombre);
  const el = document.getElementById('ms-cat');
  el.innerHTML =
    `<div class="ms-item" onclick="msCatToggle('__all__')">
      <div class="ms-check ${msCatSel.size === 0 ? 'on' : ''}"></div>
      <span style="font-weight:600">Todas</span>
    </div>` +
    items.map(item =>
      `<div class="ms-item" onclick="msCatToggle('${item}');event.stopPropagation()">
        <div class="ms-check ${msCatSel.has(item) ? 'on' : ''}"></div>
        <span>${item}</span>
      </div>`
    ).join('');
  const lbl = document.getElementById('ms-cat-label');
  if (msCatSel.size === 0) lbl.textContent = 'Todas';
  else if (msCatSel.size === 1) lbl.textContent = [...msCatSel][0];
  else lbl.textContent = `${msCatSel.size} categorías`;
}

function msCatToggle(val, event) {
  if (event) event.stopPropagation(); // ESTO evita que se cierre al marcar
  if (val === '__all__') msCatSel.clear();
  else {
    if (msCatSel.has(val)) msCatSel.delete(val);
    else msCatSel.add(val);
  }
  buildMsCat();
}

function buildMsPer() {
  const items = [...usuarios.map(u => u.name), 'Ambos'];
  const el = document.getElementById('ms-per');
  el.innerHTML =
    `<div class="ms-item" onclick="msPerToggle('__all__')">
      <div class="ms-check ${msPerSel.size === 0 ? 'on' : ''}"></div>
      <span style="font-weight:600">Todos</span>
    </div>` +
    items.map(item =>
      `<div class="ms-item" onclick="msPerToggle('${item}');event.stopPropagation()">
        <div class="ms-check ${msPerSel.has(item) ? 'on' : ''}"></div>
        <span>${item}</span>
      </div>`
    ).join('');
  const lbl = document.getElementById('ms-per-label');
  if (msPerSel.size === 0) lbl.textContent = 'Todos';
  else if (msPerSel.size === 1) lbl.textContent = [...msPerSel][0];
  else lbl.textContent = `${msPerSel.size} personas`;
}

// Construye los dropdowns single-select usados en el formulario de nuevo gasto
function buildGastoDropdowns() {
  // Moneda
  const monedas = ['ARS', 'USD'];
  const mEl = document.getElementById('f-moneda-ms');
  if (mEl) {
    mEl.innerHTML = monedas.map(item =>
      `<div class="ms-item" onclick="selectFMoneda('${item}', event)">
         <div class="ms-check ${document.getElementById('f-moneda')?.value === item ? 'on' : ''}"></div>
         <span>${item}</span>
       </div>`
    ).join('');
  }

  // Categorías
  const cEl = document.getElementById('f-cat-ms');
  if (cEl) {
    const sortedCats = categorias.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
    cEl.innerHTML = sortedCats.map(item =>
      `<div class="ms-item" onclick="selectFCat('${item.nombre}', event)">
         <div class="ms-check ${document.getElementById('f-cat')?.value === item.nombre ? 'on' : ''}"></div>
         <span>${item.nombre}</span>
       </div>`
    ).join('');
  }

  // Personas
  const pEl = document.getElementById('f-persona-ms');
  if (pEl) {
    const items = [...usuarios.map(u => u.name), 'Ambos'];
    pEl.innerHTML = items.map(item =>
      `<div class="ms-item" onclick="selectFPersona('${item}', event)">
         <div class="ms-check ${document.getElementById('f-persona')?.value === item ? 'on' : ''}"></div>
         <span>${item}</span>
       </div>`
    ).join('');
  }
}

function selectFMoneda(val, event) {
  if (event) event.stopPropagation();
  const input = document.getElementById('f-moneda'); if (input) input.value = val;
  const lbl = document.getElementById('f-moneda-label'); if (lbl) lbl.textContent = val;
  const el = document.getElementById('f-moneda-ms'); if (el) el.style.display = 'none';
  // Actualizar checks
  buildGastoDropdowns();
}

function selectFCat(val, event) {
  if (event) event.stopPropagation();
  const input = document.getElementById('f-cat'); if (input) input.value = val;
  const lbl = document.getElementById('f-cat-label'); if (lbl) lbl.textContent = val;
  const el = document.getElementById('f-cat-ms'); if (el) el.style.display = 'none';
  // Actualizar checks
  buildGastoDropdowns();
}

function selectFPersona(val, event) {
  if (event) event.stopPropagation();
  const input = document.getElementById('f-persona'); if (input) input.value = val;
  const lbl = document.getElementById('f-persona-label'); if (lbl) lbl.textContent = val;
  const el = document.getElementById('f-persona-ms'); if (el) el.style.display = 'none';
  // Actualizar checks
  buildGastoDropdowns();
}

function msPerToggle(val, event) {
  if (event) event.stopPropagation(); // ESTO evita que se cierre al marcar
  if (val === '__all__') msPerSel.clear();
  else {
    if (msPerSel.has(val)) msPerSel.delete(val);
    else msPerSel.add(val);
  }
  buildMsPer();
}

// El listener anterior fue unificado y movido arriba

function initHist() {
  const now = new Date();
  document.getElementById('h-mes').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (!msInitDone) { msCatSel.clear(); msPerSel.clear(); msInitDone = true; }
  buildMsCat();
  buildMsPer();
}

function formatTags(text) {
  if (!text) return '';
  return text.replace(/#([a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_]+)/g, '<span class="tag-badge" onclick="searchTag(\'$1\', event)">#$1</span>');
}

function searchTag(tag, event) {
  if (event) event.stopPropagation();
  const busq = document.getElementById('h-busq');
  if (busq) {
    busq.value = '#' + tag;
    switchTab('hist');
    loadHistorial();
  }
}

function loadHistorial() {
  document.querySelectorAll('.ms-dropdown').forEach(d => d.style.display = 'none');
  const mes = document.getElementById('h-mes').value;
  const busq = document.getElementById('h-busq')?.value.toLowerCase().trim();
  let f = allGastos;
  if (mes) f = f.filter(g => g.fecha && g.fecha.startsWith(mes));
  if (msCatSel.size > 0) f = f.filter(g => msCatSel.has(g.categoria));
  if (msPerSel.size > 0) f = f.filter(g => msPerSel.has(g.persona));
  if (busq) {
    f = f.filter(g => (g.descripcion || '').toLowerCase().includes(busq) || (g.notas || '').toLowerCase().includes(busq));
  }
  // La lista ya viene ordenada de la DB por fecha y created_at
  f = f.slice();
  
  const getMontoARS = (g) => {
    const m = parseFloat(g.monto || 0);
    return g.moneda === 'USD' ? m * dolarHoy : m;
  };

  const total = f.reduce((s, g) => s + getMontoARS(g), 0);

  document.getElementById('hist-list').innerHTML = f.length
    ? `<div style="font-size:12px;color:var(--text2);margin-bottom:10px">${f.length} gastos · <strong>${fmt(total)}</strong></div>` +
    f.map(g => {
      const adjuntos = g.adjuntos || [];
      const hasAdjuntos = adjuntos.length > 0;
      const adjuntosPanelHtml = hasAdjuntos ? `
        <div id="panel-${g.id}" class="adjunto-gallery" style="display:none;width:100%;margin-top:8px;flex-basis:100%">
          ${adjuntos.map(adj => `
            <div class="adjunto-gallery-item">
              <div class="adjunto-gallery-name">${getFileIcon(adj.tipo)} ${adj.nombre}</div>
              <div class="adjunto-gallery-actions" style="display:flex;gap:4px">
                <button class="adjunto-btn" onclick="viewAdjunto('${adj.path}', '${adj.tipo}')" title="Ver archivo" style="width:28px;height:28px">&#128065;&#65039;</button>
                <button class="adjunto-btn" onclick="downloadAdjunto('${adj.path}', '${adj.nombre}')" title="Descargar" style="width:28px;height:28px">&#11015;&#65039;</button>
                <button class="adjunto-btn adjunto-btn-danger" onclick="deleteAdjuntoFromGasto('${g.id}', '${adj.id}')" title="Eliminar" style="width:28px;height:28px">&#128465;</button>
              </div>
            </div>
          `).join('')}
          <button class="btn btn-primary btn-sm" onclick="agregarAdjuntoAlGasto('${g.id}')" style="width:100%;margin-top:8px">+ Agregar archivo</button>
        </div>
      ` : '';
      
      return `<div class="tx-item" style="flex-wrap:wrap">
        <div class="tx-dot" style="background:${catColor(g.categoria)}33">${catEmoji(g.categoria)}</div>
        <div class="tx-info">
          <div class="tx-desc">${formatTags(g.descripcion || g.categoria)}</div>
          <div class="tx-meta">${g.categoria} · ${personaBadge(g.persona)}${g.notas ? `<br><span style="font-size:10px">${formatTags(g.notas)}</span>` : ''}</div>
        </div>
        <div class="tx-right">
          <div class="tx-amount">${fmtGasto(g.monto, g.moneda)}</div>
          <div class="tx-date">${fdate(g.fecha)}</div>
          <div style="display:flex;gap:4px;justify-content:flex-end;align-items:center">
            ${hasAdjuntos ? `<button class="btn btn-sm" onclick="toggleAdjuntosPanel('panel-${g.id}')" title="${adjuntos.length} archivo(s)" style="margin-top:4px;padding:3px 6px;font-size:14px;border:1px solid rgba(26, 158, 117, 0.3);background:rgba(26, 158, 117, 0.05);position:relative">&#128206;</button>` : ''}
            <button class="btn btn-sm" onclick="editarGasto('${g.id}')" style="margin-top:4px;padding:3px 8px;font-size:12px;border:1px solid var(--border)">&#9999;&#65039;</button>
            <button class="btn btn-danger btn-sm" onclick="deleteGasto('${g.id}')" style="margin-top:4px;padding:3px 8px;font-size:12px">&#128465;</button>
          </div>
        </div>
        ${adjuntosPanelHtml}
      </div>`;
    }).join('')
    : '<div class="empty"><div class="empty-icon">🔍</div>Sin resultados</div>';
}

async function deleteGasto(id) {
  if (!confirm('¿Eliminar este gasto?')) return;
  const { error } = await deleteGastoDB(id);
  if (error) { showToast('Error al eliminar', 'err'); return; }
  allGastos = allGastos.filter(g => g.id !== id);
  loadHistorial(); renderDash();
  showToast('Gasto eliminado');
}

// ─── REPORTES ────────────────────────────────────────────────────────────────
let msRepCatSel = new Set();

function initRep() {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prevMonth = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  
  if (!document.getElementById('r-mes').value) document.getElementById('r-mes').value = defaultMonth;
  if (!document.getElementById('r-mes1').value) document.getElementById('r-mes1').value = prevMonth;
  if (!document.getElementById('r-mes2').value) document.getElementById('r-mes2').value = defaultMonth;

  buildMsRepCat();
}

function buildMsRepCat() {
  const items = categorias.slice().sort((a,b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })).map(c => c.nombre);
  const el = document.getElementById('ms-rep-cat');
  el.innerHTML =
    `<div class="ms-item" onclick="msRepCatToggle('__all__')">
      <div class="ms-check ${msRepCatSel.size === 0 ? 'on' : ''}"></div>
      <span style="font-weight:600">Todas</span>
    </div>` +
    items.map(item =>
      `<div class="ms-item" onclick="msRepCatToggle('${item}');event.stopPropagation()">
        <div class="ms-check ${msRepCatSel.has(item) ? 'on' : ''}"></div>
        <span>${item}</span>
      </div>`
    ).join('');
  const lbl = document.getElementById('ms-rep-cat-label');
  if (msRepCatSel.size === 0) lbl.textContent = 'Todas';
  else if (msRepCatSel.size === 1) lbl.textContent = [...msRepCatSel][0];
  else lbl.textContent = `${msRepCatSel.size} categorías`;
}

function msRepCatToggle(val, event) {
  if (event) event.stopPropagation();
  if (val === '__all__') msRepCatSel.clear();
  else {
    if (msRepCatSel.has(val)) msRepCatSel.delete(val);
    else msRepCatSel.add(val);
  }
  buildMsRepCat();
}

function togglePeriodo() {
  const tipo = document.getElementById('r-tipo').value;
  document.getElementById('rg-mes').style.display = tipo === 'mes' ? '' : 'none';
  document.getElementById('rg-per').style.display = tipo === 'per' ? '' : 'none';
  document.getElementById('rg-comp').style.display = tipo === 'comp' ? '' : 'none';
}

function getReporteData() {
  const tipo = document.getElementById('r-tipo').value;
  
  const incFijos = document.getElementById('r-inc-fijos')?.checked;
  const incCuotas = document.getElementById('r-inc-cuotas')?.checked;
  
  const aplicarFiltros = (lista) => {
    return lista.filter(g => {
      if (msRepCatSel.size > 0 && !msRepCatSel.has(g.categoria)) return false;
      const isFijo = g.notas && (g.notas.includes('Carga automática') || g.notas.includes('Fijo'));
      const isCuota = g.categoria === 'Deudas' || (g.notas && g.notas.includes('Pago de cuota de'));
      if (!incFijos && isFijo) return false;
      if (!incCuotas && isCuota) return false;
      return true;
    }).sort((a, b) => {
      const dateComp = (b.fecha || '').localeCompare(a.fecha || '');
      if (dateComp !== 0) return dateComp;
      return (a.categoria || '').localeCompare(b.categoria || '');
    });
  };

  if (tipo === 'mes') {
    const mes = document.getElementById('r-mes').value;
    if (!mes) { showToast('Seleccioná un mes', 'err'); return null; }
    const [y, m] = mes.split('-');
    return { 
      list: aplicarFiltros(allGastos.filter(g => g.fecha && g.fecha.startsWith(mes))), 
      label: `${MESES[parseInt(m) - 1]} ${y}`,
      tipo: 'mes'
    };
  } else if (tipo === 'per') {
    const desde = document.getElementById('r-desde').value, hasta = document.getElementById('r-hasta').value;
    if (!desde || !hasta) { showToast('Seleccioná fechas', 'err'); return null; }
    return { 
      list: aplicarFiltros(allGastos.filter(g => g.fecha >= desde && g.fecha <= hasta)), 
      label: `${fdate(desde)} al ${fdate(hasta)}`,
      tipo: 'per'
    };
  } else if (tipo === 'comp') {
    const mes1 = document.getElementById('r-mes1').value;
    const mes2 = document.getElementById('r-mes2').value;
    if (!mes1 || !mes2) { showToast('Seleccioná ambos meses', 'err'); return null; }
    const [y1, m1] = mes1.split('-');
    const [y2, m2] = mes2.split('-');
    return {
      list1: aplicarFiltros(allGastos.filter(g => g.fecha && g.fecha.startsWith(mes1))),
      label1: `${MESES[parseInt(m1) - 1]} ${y1}`,
      list2: aplicarFiltros(allGastos.filter(g => g.fecha && g.fecha.startsWith(mes2))),
      label2: `${MESES[parseInt(m2) - 1]} ${y2}`,
      tipo: 'comp'
    };
  }
}

function previewReporte() {
  const r = getReporteData(); if (!r) return;
  const div = document.getElementById('rep-preview');
  const highlightsDiv = document.getElementById('rep-highlights');
  const chartContainer = document.getElementById('rep-chart-container');
  
  const getMontoARS = (g) => {
    const m = parseFloat(g.monto || 0);
    return g.moneda === 'USD' ? m * dolarHoy : m;
  };

  if (r.tipo === 'comp') {
    const { list1, label1, list2, label2 } = r;
    highlightsDiv.style.display = 'none';
    chartContainer.style.display = 'none';
    
    if (!list1.length && !list2.length) { div.innerHTML = '<div class="empty">Sin datos para los períodos seleccionados</div>'; return; }
    
    const total1 = list1.reduce((s, g) => s + getMontoARS(g), 0);
    const total2 = list2.reduce((s, g) => s + getMontoARS(g), 0);
    
    const catMap = {};
    list1.forEach(g => { catMap[g.categoria] = catMap[g.categoria] || { m1: 0, m2: 0 }; catMap[g.categoria].m1 += getMontoARS(g); });
    list2.forEach(g => { catMap[g.categoria] = catMap[g.categoria] || { m1: 0, m2: 0 }; catMap[g.categoria].m2 += getMontoARS(g); });
    
    const difTotal = total2 - total1;
    const difTotalPct = total1 ? (difTotal / total1) * 100 : 0;
    const difColor = difTotal > 0 ? 'var(--red)' : 'var(--green)';
    const difIcon = difTotal > 0 ? '↑' : (difTotal < 0 ? '↓' : '=');

    let html = `<div style="text-align:center; padding:12px; background:var(--bg2); border-radius:8px; margin-bottom:16px;">
      <div style="font-size:12px; color:var(--text2)">Diferencia Total</div>
      <div style="font-size:24px; font-weight:bold; color:${difColor}">${difIcon} ${fmt(Math.abs(difTotal))} <span style="font-size:14px">(${Math.abs(difTotalPct).toFixed(1)}%)</span></div>
      <div style="font-size:12px; color:var(--text3); margin-top:4px">${label2} respecto a ${label1}</div>
    </div>`;

    html += `<table style="width:100%; table-layout:fixed; font-size:12px; text-align:right">
      <colgroup><col style="width:auto; text-align:left"><col style="width:24%"><col style="width:24%"><col style="width:27%"></colgroup>
      <tr style="color:var(--text2); font-size:10px"><th style="text-align:left; padding-bottom:8px">Categoría</th><th>${label1}</th><th>${label2}</th><th>Variación</th></tr>`;

    Object.keys(catMap).sort((a, b) => a.localeCompare(b)).forEach(c => {
      const { m1, m2 } = catMap[c];
      const dif = m2 - m1;
      const difPct = m1 ? (dif / m1) * 100 : 0;
      const color = dif > 0 ? 'var(--red)' : (dif < 0 ? 'var(--green)' : 'var(--text3)');
      html += `<tr>
        <td style="text-align:left; padding:8px 0; border-bottom:1px solid var(--border); white-space:nowrap; overflow:hidden; text-overflow:ellipsis">
          <span style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:${catColor(c)};display:inline-block;flex-shrink:0"></span><span style="overflow:hidden;text-overflow:ellipsis">${c}</span></span>
        </td>
        <td style="padding:8px 0; border-bottom:1px solid var(--border); white-space:nowrap">${fmt(m1)}</td>
        <td style="padding:8px 0; border-bottom:1px solid var(--border); white-space:nowrap">${fmt(m2)}</td>
        <td style="padding:8px 0; border-bottom:1px solid var(--border); color:${color}; font-size:11px; white-space:nowrap">${dif > 0 ? '+' : ''}${fmt(dif)} <span style="font-size:10px">(${difPct > 0 ? '+' : ''}${difPct.toFixed(0)}%)</span></td>
      </tr>`;
    });
    
    html += `<tr style="font-weight:bold; font-size:12px">
      <td style="text-align:left; padding:12px 0">TOTAL</td>
      <td style="padding:12px 0; white-space:nowrap">${fmt(total1)}</td>
      <td style="padding:12px 0; white-space:nowrap">${fmt(total2)}</td>
      <td style="padding:12px 0; color:${difColor}; white-space:nowrap">${difIcon} ${Math.abs(difTotalPct).toFixed(1)}%</td>
    </tr></table>`;
    
    div.innerHTML = html;
    return;
  }

  // --- Normal / Mes ---
  const { list, label } = r;
  if (!list.length) { 
    div.innerHTML = '<div class="empty">Sin datos para el período</div>'; 
    highlightsDiv.style.display = 'none';
    chartContainer.style.display = 'none';
    return; 
  }
  
  const total = list.reduce((s, g) => s + getMontoARS(g), 0);
  const catMap = {};
  list.forEach(g => { 
    const montoARS = getMontoARS(g);
    catMap[g.categoria] = (catMap[g.categoria] || 0) + montoARS; 
  });
  
  // Calcular Highlights
  let dias = 1;
  if (r.tipo === 'mes') {
    const mesArr = document.getElementById('r-mes').value.split('-');
    dias = new Date(mesArr[0], mesArr[1], 0).getDate();
  } else {
    const d1 = new Date(document.getElementById('r-desde').value);
    const d2 = new Date(document.getElementById('r-hasta').value);
    dias = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1);
  }
  const avgDia = total / dias;
  
  let maxGasto = list[0];
  list.forEach(g => { if (getMontoARS(g) > getMontoARS(maxGasto)) maxGasto = g; });
  
  let topCat = ''; let topCatMax = 0;
  Object.keys(catMap).forEach(c => { if(catMap[c] > topCatMax) { topCatMax = catMap[c]; topCat = c; } });

  // Calcular Ahorros del período
  let ahoList = [];
  if (r.tipo === 'mes') {
    ahoList = allAhorros.filter(a => a.fecha && a.fecha.startsWith(document.getElementById('r-mes').value));
  } else {
    const d1 = document.getElementById('r-desde').value;
    const d2 = document.getElementById('r-hasta').value;
    ahoList = allAhorros.filter(a => a.fecha && a.fecha >= d1 && a.fecha <= d2);
  }
  const totalAho = ahoList.reduce((s, a) => s + getMontoARS(a), 0);

  highlightsDiv.style.display = 'block';
  highlightsDiv.innerHTML = `
    <div style="margin-bottom:16px;border:1px solid var(--border);border-radius:8px;overflow:hidden">
      <div style="padding:0">
        <table style="width:100%;table-layout:fixed;font-size:13px">
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:10px 12px;font-weight:600;font-size:14px;color:var(--text)">Resumen del Período</td>
            <td style="padding:10px 12px;text-align:right;font-weight:700;font-size:14px;color:var(--text)">${fmt(total)}</td>
          </tr>
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:10px 12px;color:var(--text2)">Promedio Diario</td>
            <td style="padding:10px 12px;text-align:right;font-weight:500">${fmt(avgDia)}</td>
          </tr>
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:10px 12px;color:var(--text2)">Mayor Gasto</td>
            <td style="padding:10px 12px;text-align:right;font-weight:500" title="${maxGasto ? (maxGasto.descripcion || maxGasto.categoria) : ''}">${maxGasto ? (maxGasto.descripcion || maxGasto.categoria).substring(0, 25) : '-'}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px;color:var(--text2)">Categoría Principal</td>
            <td style="padding:10px 12px;text-align:right;font-weight:500;color:${catColor(topCat)}">${topCat}</td>
          </tr>
        </table>
      </div>
    </div>
    
    <div style="margin-bottom:16px;border:1px solid var(--border);border-radius:8px;overflow:hidden">
      <div style="padding:0">
        <table style="width:100%;table-layout:fixed;font-size:13px">
          <tr>
            <td style="padding:10px 12px;font-weight:600;font-size:14px;color:var(--text)">Ahorro del Período</td>
            <td style="padding:10px 12px;text-align:right;font-weight:700;font-size:14px;color:var(--green)">${fmt(totalAho)}</td>
          </tr>
        </table>
      </div>
    </div>
  `;

  // Chart
  chartContainer.style.display = 'block';
  const ctx = document.getElementById('repChart').getContext('2d');
  if (window.repChartInstance) window.repChartInstance.destroy();
  
  const chartCats = Object.keys(catMap).sort((a,b) => catMap[b] - catMap[a]);
  const chartData = chartCats.map(c => catMap[c]);
  const chartColors = chartCats.map(c => catColor(c));
  
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  window.repChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: chartCats,
      datasets: [{ 
        data: chartData, 
        backgroundColor: chartColors, 
        borderWidth: isDark ? 2 : 1,
        borderColor: isDark ? '#1a1a18' : '#ffffff'
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { 
          position: 'right', 
          labels: { 
            color: isDark ? '#e1e1df' : '#1a1a18', 
            font: {size: 11}, 
            boxWidth: 12 
          } 
        },
        tooltip: {
          callbacks: { label: (ctx) => ` ${ctx.label}: ${fmt(ctx.raw)}` }
        }
      },
      cutout: '70%'
    }
  });

  const catGroups = {};
  list.forEach(g => {
    if (!catGroups[g.categoria]) catGroups[g.categoria] = { total: 0, gastos: [] };
    catGroups[g.categoria].total += getMontoARS(g);
    catGroups[g.categoria].gastos.push(g);
  });
  const catsSorted = Object.keys(catGroups).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

  const detallePorCatHtml = catsSorted.map(cat => {
    const { total: subtotal, gastos: gs } = catGroups[cat];
    const gastosRows = gs
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))
      .map(g => `<tr>
        <td style="white-space:nowrap;padding:4px 6px">${fdate(g.fecha)}</td>
        <td style="padding:4px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${(g.descripcion || '-').replace(/"/g, '&quot;')}">${g.descripcion || '-'}</td>
        <td style="padding:4px 6px">${g.persona}</td>
        <td style="text-align:right;padding:4px 6px;font-weight:500">${fmtGasto(g.monto, g.moneda)}</td>
      </tr>`).join('');
    return `
      <div style="margin-bottom:10px;border:1px solid var(--border);border-radius:8px;overflow:hidden">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:${catColor(cat)}22;border-bottom:1px solid var(--border)">
          <span style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px">
            <span style="width:10px;height:10px;border-radius:50%;background:${catColor(cat)};display:inline-block"></span>${cat}
          </span>
          <span style="font-weight:700;font-size:13px">${fmt(subtotal)}</span>
        </div>
        <div class="rep-scroll">
          <table style="width:100%;table-layout:fixed">
            <colgroup>
              <col style="width:90px">
              <col style="width:auto">
              <col style="width:80px">
              <col style="width:105px">
            </colgroup>
            <tr style="font-size:11px;color:var(--text2)">
              <th style="padding:4px 6px;text-align:left">Fecha</th>
              <th style="padding:4px 6px;text-align:left">Descripción</th>
              <th style="padding:4px 6px;text-align:left">Persona</th>
              <th style="padding:4px 6px;text-align:right">Monto</th>
            </tr>
            ${gastosRows}
          </table>
        </div>
      </div>`;
  }).join('');

  div.innerHTML = `<div class="rep-total"><span>${label} · ${list.length} gastos</span><span>${fmt(total)}</span></div>` +
    `<div class="rep-scroll" style="margin-top:14px"><table style="table-layout:fixed">
  <colgroup>
    <col style="width:90px">
    <col style="width:auto">
    <col style="width:90px">
    <col style="width:105px">
  </colgroup>
  <tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th style="text-align:right">Monto</th></tr>
  ${list.map(g => `<tr>
    <td style="white-space:nowrap;padding:8px 6px">${fdate(g.fecha)}</td>
    <td style="padding:8px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${(g.descripcion || '-').replace(/"/g, '&quot;')}">${g.descripcion || '-'}</td>
    <td style="padding:8px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${g.categoria}">${g.categoria}</td>
    <td style="text-align:right;padding:8px 6px;font-weight:600">${fmtGasto(g.monto, g.moneda)}</td>
  </tr>`).join('')}
  <tr class="rep-total-row"><td colspan="3">TOTAL (${prefMoneda})</td><td style="text-align:right">${fmt(total)}</td></tr>
</table></div>
<div style="margin-top:20px">
  <div style="font-size:13px;font-weight:700;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid var(--border)">Detalle por Categoría</div>
  ${detallePorCatHtml}
</div>`;
}

function exportarExcel() {
  const r = getReporteData(); if (!r) return;
  
  if (r.tipo === 'comp') {
    showToast('La exportación de Comparativas a Excel se implementará pronto.', 'info');
    return;
  }
  
  const { list, label } = r;
  if (!list.length) { showToast('Sin datos', 'err'); return; }
  const wb = XLSX.utils.book_new();
  const data = [['Fecha', 'Descripción', 'Categoría', 'Persona', `Monto (${prefMoneda})`, 'Notas', 'Moneda Original', 'Monto Original']];
  
  const getMontoARS = (g) => {
    const m = parseFloat(g.monto || 0);
    return g.moneda === 'USD' ? m * dolarHoy : m;
  };

  list.forEach(g => {
    const montoConsolidadoRaw = prefMoneda === 'USD' ? (getMontoARS(g) / dolarHoy) : getMontoARS(g);
    const montoConsolidado = prefMoneda === 'USD' ? Number(montoConsolidadoRaw.toFixed(2)) : montoConsolidadoRaw;
    data.push([
      fdate(g.fecha), 
      g.descripcion || '', 
      g.categoria, 
      g.persona, 
      montoConsolidado, 
      g.notas || '', 
      g.moneda || 'ARS', 
      parseFloat(g.monto)
    ]);
  });

  const totalARS = list.reduce((s, g) => s + getMontoARS(g), 0);
  const totalConsolidadoRaw = prefMoneda === 'USD' ? (totalARS / dolarHoy) : totalARS;
  const totalConsolidado = prefMoneda === 'USD' ? Number(totalConsolidadoRaw.toFixed(2)) : totalConsolidadoRaw;
  
  data.push(['', '', '', 'TOTAL CONSOLIDADO', totalConsolidado, '', prefMoneda, '']);
  
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 18 }, { wch: 12 }, { wch: 16 }, { wch: 25 }, { wch: 15 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Gastos');

  // --- NUEVA SOLAPA: POR CATEGORÍA ---
  const resumenData = [['Categoría', 'Fecha', 'Descripción', `Monto (${prefMoneda})`]];
  
  const listSorted = [...list].sort((a, b) => {
    if (a.categoria < b.categoria) return -1;
    if (a.categoria > b.categoria) return 1;
    return (a.fecha || '').localeCompare(b.fecha || '');
  });

  let currentCat = null;
  let subtotalCat = 0;

  listSorted.forEach(g => {
    const montoRaw = prefMoneda === 'USD' ? (getMontoARS(g) / dolarHoy) : getMontoARS(g);
    const monto = prefMoneda === 'USD' ? Number(montoRaw.toFixed(2)) : montoRaw;
    if (currentCat !== g.categoria) {
      if (currentCat !== null) {
        resumenData.push(['', '', 'SUBTOTAL ' + currentCat.toUpperCase(), prefMoneda === 'USD' ? Number(subtotalCat.toFixed(2)) : subtotalCat]);
        resumenData.push([]); // Espacio visual
      }
      currentCat = g.categoria;
      subtotalCat = 0;
    }
    subtotalCat += monto;
    resumenData.push([g.categoria, fdate(g.fecha), g.descripcion || '', monto]);
  });

  if (currentCat !== null) {
    resumenData.push(['', '', 'SUBTOTAL ' + currentCat.toUpperCase(), prefMoneda === 'USD' ? Number(subtotalCat.toFixed(2)) : subtotalCat]);
  }
  
  resumenData.push([]);
  resumenData.push(['', '', 'TOTAL GENERAL', totalConsolidado]);
  
  const wsResumen = XLSX.utils.aoa_to_sheet(resumenData);
  wsResumen['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 30 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Por Categoría');
  // ------------------------------------

  XLSX.writeFile(wb, `Gastos_${label.replace(/\//g, '-').replace(/ /g, '_')}.xlsx`);
  showToast('Excel exportado ✓');
}

function exportarPDF() {
  const r = getReporteData(); if (!r) return;
  
  if (r.tipo === 'comp') {
    showToast('La exportación de Comparativas a PDF se implementará pronto.', 'info');
    return;
  }

  const { list, label } = r;
  if (!list.length) { showToast('Sin datos', 'err'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16); doc.setFont('helvetica', 'bold');
  doc.text('Reporte de Gastos Familiares', 14, 18);
  doc.setFontSize(11); doc.setFont('helvetica', 'normal');
  doc.text(`Período: ${label} (Consolidado en ${prefMoneda})`, 14, 27);

  const getMontoARS = (g) => {
    const m = parseFloat(g.monto || 0);
    return g.moneda === 'USD' ? m * dolarHoy : m;
  };

  const totalARS = list.reduce((s, g) => s + getMontoARS(g), 0);
  const catMap = {};
  list.forEach(g => { 
    const montoARS = getMontoARS(g);
    catMap[g.categoria] = (catMap[g.categoria] || 0) + montoARS; 
  });

  doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.text('Resumen por categoría', 14, 38);
  let y = 45;
  Object.entries(catMap).sort((a, b) => b[1] - a[1]).forEach(([c, v]) => {
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    const vConsolidado = prefMoneda === 'USD' ? (v / dolarHoy) : v;
    doc.text(`${c}: ${prefMoneda === 'USD' ? 'U$D ' : '$'} ${vConsolidado.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 18, y); y += 6;
  });

  y += 4; doc.setFont('helvetica', 'bold');
  const tConsolidado = prefMoneda === 'USD' ? (totalARS / dolarHoy) : totalARS;
  doc.text(`TOTAL GENERAL: ${prefMoneda === 'USD' ? 'U$D ' : '$'} ${tConsolidado.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 14, y); y += 10;

  doc.autoTable({
    head: [['Fecha', 'Descripción', 'Categoría', 'Persona', `Monto (${prefMoneda})`]],
    body: list.map(g => {
      const mConsolidado = prefMoneda === 'USD' ? (getMontoARS(g) / dolarHoy) : getMontoARS(g);
      const symbol = prefMoneda === 'USD' ? 'U$D ' : '$';
      return [
        fdate(g.fecha), 
        g.descripcion || '', 
        g.categoria, 
        g.persona, 
        symbol + mConsolidado.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      ];
    }),
    startY: y, styles: { fontSize: 9 }, headStyles: { fillColor: [26, 26, 24] },
    foot: [['', '', '', 'TOTAL', fmt(totalARS)]],
    footStyles: { fontStyle: 'bold' },
    showFoot: 'lastPage'
  });

  // ── NUEVA PÁGINA: Detalle por categoría (alfabético) ──
  doc.addPage();
  doc.setFontSize(14); doc.setFont('helvetica', 'bold');
  doc.text('Detalle por Categoría', 14, 18);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text(`Período: ${label} · Consolidado en ${prefMoneda}`, 14, 26);

  const listSortedAlpha = [...list].sort((a, b) => {
    const catComp = (a.categoria || '').localeCompare(b.categoria || '', 'es', { sensitivity: 'base' });
    if (catComp !== 0) return catComp;
    return (a.fecha || '').localeCompare(b.fecha || '');
  });

  const symbol = prefMoneda === 'USD' ? 'U$D ' : '$';
  const catGroups = {};
  listSortedAlpha.forEach(g => {
    if (!catGroups[g.categoria]) catGroups[g.categoria] = [];
    catGroups[g.categoria].push(g);
  });

  const catDetBody = [];
  Object.keys(catGroups).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })).forEach(cat => {
    const gastosCat = catGroups[cat];
    const subtotalARS = gastosCat.reduce((s, g) => s + getMontoARS(g), 0);
    const subtotalConsolidado = prefMoneda === 'USD' ? (subtotalARS / dolarHoy) : subtotalARS;
    // Fila de cabecera de categoría
    catDetBody.push([{ content: cat, colSpan: 4, styles: { fontStyle: 'bold', fillColor: [240, 240, 240], textColor: [30, 30, 30] } }]);
    // Filas de gastos
    gastosCat.forEach(g => {
      const mConsolidado = prefMoneda === 'USD' ? (getMontoARS(g) / dolarHoy) : getMontoARS(g);
      catDetBody.push([
        fdate(g.fecha),
        g.descripcion || '-',
        g.persona,
        symbol + mConsolidado.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      ]);
    });
    // Fila de subtotal
    catDetBody.push([
      '', '',
      { content: `Subtotal ${cat}`, styles: { fontStyle: 'bold' } },
      { content: symbol + subtotalConsolidado.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), styles: { fontStyle: 'bold' } }
    ]);
    // Fila vacía como separador
    catDetBody.push([{ content: '', colSpan: 4, styles: { minCellHeight: 3, fillColor: [255, 255, 255] } }]);
  });

  doc.autoTable({
    head: [['Fecha', 'Descripción', 'Persona', `Monto (${prefMoneda})`]],
    body: catDetBody,
    startY: 32,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [26, 26, 24] },
    foot: [['', '', 'TOTAL GENERAL', symbol + tConsolidado.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })]],
    footStyles: { fontStyle: 'bold', fillColor: [26, 26, 24], textColor: [255, 255, 255] },
    showFoot: 'lastPage'
  });
  // ───────────────────────────────────────────────────────

  doc.save(`Gastos_${label.replace(/\//g, '-').replace(/ /g, '_')}.pdf`);
  showToast('PDF exportado ✓');
}

function exportarBackup() {
  const wb = XLSX.utils.book_new();
  // Hoja Gastos - con nombre en lugar de email
  const data = [['Fecha', 'Descripción', 'Categoría', 'Quién pagó', 'Cargado por', 'Monto ($)', 'Notas']];
  allGastos.forEach(g => {
    const cargadoPor = usuarios.find(u => u.id === g.user_id)?.name || (g.user_email ? g.user_email.split('@')[0] : '');
    data.push([fdate(g.fecha), g.descripcion || '', g.categoria, g.persona, cargadoPor, parseFloat(g.monto), g.notas || '']);
  });
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 18 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Gastos');
  // Hoja Categorias
  const catData = [['Nombre', 'Color']];
  categorias.forEach(c => catData.push([c.nombre, c.color]));
  const wsCat = XLSX.utils.aoa_to_sheet(catData);
  wsCat['!cols'] = [{ wch: 20 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsCat, 'Categorias');
  XLSX.writeFile(wb, 'GastosFamiliares_Backup.xlsx');
  showToast('Backup descargado ✓');
}

// ─── CONFIG ──────────────────────────────────────────────────────────────────
async function addCategoria() {
  const nombre = document.getElementById('new-cat').value.trim();
  const presupuesto = parseInputFloat(document.getElementById('new-cat-ppto').value);
  const color = document.getElementById('new-cat-color').value;
  if (!nombre) { showToast('Escribí el nombre', 'err'); return; }
  if (categorias.find(c => c.nombre.toLowerCase() === nombre.toLowerCase())) { showToast('Ya existe esa categoría', 'err'); return; }
  
  try {
    const { data, error } = await sbWithTimeout(() => sb.from('categorias').insert([{ nombre, color, presupuesto }]).select());
    if (error) throw error;
    if (data) categorias.push(data[0]);
    document.getElementById('new-cat').value = '';
    document.getElementById('new-cat-ppto').value = '';
    renderConfig(); initForm();
    showToast('Categoría agregada ✓');
  } catch (error) {
    showToast('Error al guardar: ' + error.message, 'err');
  }
}

function renderConfig() {
  document.getElementById('cfg-cats').innerHTML = categorias.map((c, i) =>
    `<div class="cat-cfg-item">
  <span style="width:16px;height:16px;border-radius:50%;background:${c.color};display:inline-block;flex-shrink:0"></span>
  <div style="flex:1">
    <div style="font-size:14px;font-weight:600">${c.nombre}</div>
    <div style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text3)">
      <span>Presupuesto: $</span>
      <input type="number" value="${c.presupuesto || 0}" 
        onchange="updateCategoriaPpto('${c.id}', this.value)" 
        style="width:80px;padding:2px 4px;font-size:11px;border:1px solid var(--border);border-radius:4px;background:transparent;color:var(--text);font-family:inherit">
    </div>
  </div>
  <button class="btn btn-danger btn-sm" onclick="deleteCategoria('${c.id}')">🗑</button>
</div>`
  ).join('');

  const tarjetas = getTarjetas();
  document.getElementById('cfg-tarjetas').innerHTML = tarjetas.map(t => {
    const cfg = tarjetasCfg.find(c => c.tarjeta === t) || { dia_cierre: 15 };
    const color = cfg.color || TARJETA_COLORS[t] || '#666';
    const isDefault = ['Visa', 'Mastercard', 'Amex'].includes(t);
    return `<div class="cat-cfg-item">
      <span class="tarjeta-badge" style="background:${color};color:white;width:80px;justify-content:center">${t}</span>
      <div style="flex:1;display:flex;align-items:center;gap:8px;justify-content:flex-end">
        <span style="font-size:12px">Cierra día:</span>
        <input type="number" value="${cfg.dia_cierre}" min="1" max="31" 
          onchange="saveTarjetaConfig('${t}', this.value)" 
          style="width:50px;padding:4px;font-size:12px;text-align:center">
      </div>
      ${!isDefault ? `<button class="btn btn-danger btn-sm" onclick="deleteTarjeta('${t}')">🗑</button>` : ''}
    </div>`;
  }).join('');
}

async function updatePrefMoneda(val) {
  prefMoneda = val;
  localStorage.setItem('prefMoneda', val);
  initForm(); // Actualizar moneda por defecto en gastos
  renderDash();
  renderDeudas();
  renderRecurrentes();
  renderConfig();
  showToast(`Moneda cambiada a ${val} ✓`);
}

async function deleteCategoria(id) {
  if (!confirm('¿Eliminar esta categoría?')) return;
  const { error } = await deleteCategoriaDB(id);
  if (error) { showToast('Error al eliminar', 'err'); return; }
  categorias = categorias.filter(c => c.id !== id);
  renderConfig(); initForm();
}

async function updateCategoriaPpto(id, ppto) {
  const valor = parseInputFloat(ppto);
  try {
    const { error } = await sbWithTimeout(() => sb.from('categorias').update({ presupuesto: valor }).eq('id', id));
    if (error) throw error;
    const cat = categorias.find(c => c.id === id);
    if (cat) cat.presupuesto = valor;
    renderDash();
    showToast('Presupuesto actualizado ✓');
  } catch (error) {
    showToast('Error al actualizar presupuesto: ' + error.message, 'err');
  }
}

async function addTarjeta() {
  const nombre = document.getElementById('new-tarjeta').value.trim();
  const cierre = parseInt(document.getElementById('new-tarjeta-cierre').value) || 15;
  const color = document.getElementById('new-tarjeta-color').value;

  if (!nombre) { showToast('Escribí el nombre de la tarjeta', 'err'); return; }
  
  try {
    const payload = {
      tarjeta: nombre,
      dia_cierre: cierre,
      color: color,
      user_id: currentUser.id
    };
    
    const { error } = await sbWithTimeout(() => sb.from('tarjetas_config').upsert(payload, { onConflict: 'tarjeta' }));
    
    if (error) {
      if (error.message && error.message.includes('column "color"')) {
        showToast('Debes crear la columna "color" (tipo text) en la tabla tarjetas_config en Supabase', 'err');
      } else {
        throw error;
      }
      return;
    }
    
    await loadTarjetasConfig();
    document.getElementById('new-tarjeta').value = '';
    document.getElementById('new-tarjeta-cierre').value = '';
    renderConfig();
    renderDeudas();
    showToast('Tarjeta agregada ✓');
  } catch (error) {
    showToast('Error al guardar: ' + error.message, 'err');
  }
}

async function deleteTarjeta(nombre) {
  if (!confirm(`¿Eliminar la tarjeta ${nombre}?`)) return;
  try {
    const { error } = await sbWithTimeout(() => sb.from('tarjetas_config').delete().eq('tarjeta', nombre));
    if (error) throw error;
    await loadTarjetasConfig();
    renderConfig();
    renderDeudas();
    showToast('Tarjeta eliminada ✓');
  } catch (error) {
    showToast('Error al eliminar: ' + error.message, 'err');
  }
}

// ─── DEUDAS ──────────────────────────────────────────────────────────────────
let allDeudas = [];
const TARJETA_COLORS = { Visa:'#1a1f71', Mastercard:'#eb001b', Amex:'#2e77bc' };
const TARJETA_EMOJIS = { Visa:'💳', Mastercard:'💳', Amex:'💎' };
const MESES_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function getTarjetas() {
  const custom = tarjetasCfg.map(c => c.tarjeta);
  const activas = allDeudas ? allDeudas.map(d => d.tarjeta) : [];
  return [...new Set(['Visa', 'Mastercard', 'Amex', ...custom, ...activas])].filter(Boolean);
}

async function loadDeudas() {
  const { data, error } = await sb.from('deudas').select('*').order('created_at', { ascending: false });
  if (data) allDeudas = data;
}

function showFormDeuda() {
  const now = new Date();
  document.getElementById('d-inicio').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  
  document.getElementById('d-moneda').value = prefMoneda;

  // Ordenar: primero el usuario logueado, luego los demás
  const yo = usuarios.find(u => u.id === currentUser.id);
  const resto = usuarios.filter(u => u.id !== currentUser.id);
  const ordenados = yo ? [yo, ...resto] : usuarios;
  document.getElementById('d-persona').innerHTML = ordenados.map((u, i) =>
    `<option value="${u.name}">${u.name}${i === 0 ? ' (yo)' : ''}</option>`
  ).join('');
  const tarjetas = getTarjetas();
  document.getElementById('d-tarjeta').innerHTML = tarjetas.map(t => `<option value="${t}">${t}</option>`).join('');
  document.getElementById('deu-form').style.display = 'block';
  document.getElementById('deu-form').scrollIntoView({ behavior:'smooth' });
}

function hideFormDeuda() {
  document.getElementById('deu-form').style.display = 'none';
  ['d-desc','d-monto','d-cuotas','d-notas'].forEach(id => document.getElementById(id).value = '');
}

async function saveDeuda() {
  const desc = document.getElementById('d-desc').value.trim();
  const montoRaw = document.getElementById('d-monto').value;
  const monto = parseInputFloat(montoRaw);
  const moneda = document.getElementById('d-moneda').value;
  const cuotas = parseInt(document.getElementById('d-cuotas').value);
  const inicio = document.getElementById('d-inicio').value;
  const tarjeta = document.getElementById('d-tarjeta').value;
  const persona = document.getElementById('d-persona').value;
  const notas = document.getElementById('d-notas').value.trim();
  if (!desc) { showToast('Ingresá una descripción', 'err'); return; }
  if (!montoRaw || isNaN(monto) || monto <= 0) { showToast('Ingresá un monto válido', 'err'); return; }
  if (!cuotas || cuotas < 1) { showToast('Ingresá la cantidad de cuotas', 'err'); return; }
  if (!inicio) { showToast('Seleccioná el mes de inicio', 'err'); return; }
  const btn = document.getElementById('d-save-btn');
  btn.innerHTML = '<span class="spinner"></span> Guardando...'; btn.classList.add('btn-loading');
  const deuda = { descripcion:desc, monto_total:monto, moneda, cuotas_total:cuotas,
    cuotas_pagas:0, mes_inicio:inicio, tarjeta, persona, notas,
    monto_cuota: Math.round(monto/cuotas*100)/100,
    user_id: currentUser.id, user_email: currentUser.email };
  
  try {
    const { error } = await sbWithTimeout(() => sb.from('deudas').insert([deuda]));
    if (error) throw error;
    
    allDeudas.unshift({...deuda, id: Date.now()});
    hideFormDeuda();
    renderDeudas();
    renderDash();
    showToast('Deuda guardada ✓');
  } catch(e) {
    showToast('Error: ' + e.message, 'err');
  } finally {
    btn.innerHTML = 'Guardar';
    btn.classList.remove('btn-loading');
  }
}

async function deleteDeuda(id) {
  if (!confirm('¿Eliminar esta deuda?')) return;
  try {
    const { error } = await sbWithTimeout(() => sb.from('deudas').delete().eq('id', id));
    if (error) throw error;
    allDeudas = allDeudas.filter(d => d.id !== id);
    renderDeudas();
    showToast('Deuda eliminada');
  } catch (error) {
    showToast('Error al eliminar: ' + error.message, 'err');
  }
}

let deudaEnPago = null;

function cerrarModalPago() {
  document.getElementById('modal-pago').style.display = 'none';
  deudaEnPago = null;
}

async function pagarCuota(id) {
  const d = allDeudas.find(x => x.id === id);
  if (!d) return;
  
  deudaEnPago = d;
  document.getElementById('m-pago-desc').textContent = d.descripcion;
  document.getElementById('m-fecha-pago').value = new Date().toISOString().split('T')[0];
  document.getElementById('modal-pago').style.display = 'flex';
}

async function confirmarPagoCuota() {
  if (!deudaEnPago) return;
  const d = deudaEnPago;
  const fechaPago = document.getElementById('m-fecha-pago').value;
  if (!fechaPago) { showToast('Seleccioná la fecha', 'err'); return; }

  cerrarModalPago();

  const nuevasPagas = (d.cuotas_pagas || 0) + 1;
  
  showToast('Procesando pago...', 'info');
  
  try {
    // 1. Actualizar la deuda
    const { error: errorDeuda } = await sbWithTimeout(() => sb.from('deudas').update({ cuotas_pagas: nuevasPagas }).eq('id', d.id));
    if (errorDeuda) throw errorDeuda;
    
    // 2. Crear un gasto automático para que se vea en el dashboard
    const gasto = {
      fecha: fechaPago,
      monto: d.monto_cuota,
      moneda: d.moneda,
      categoria: 'Deudas',
      persona: d.persona,
      descripcion: `Pago Cuota ${nuevasPagas}/${d.cuotas_total}: ${d.descripcion}`,
      notas: `Pago de cuota de ${d.tarjeta}. Deuda ID: ${d.id}`,
      user_id: currentUser.id,
      user_email: currentUser.email
    };
    
    const { error: errorGasto } = await sbWithTimeout(() => sb.from('gastos').insert([gasto]));
    
    if (errorGasto) {
      showToast('Cuota marcada, pero no se pudo crear el gasto', 'warn');
    } else {
      showToast('Cuota pagada y registrada en gastos ✓');
    }

    d.cuotas_pagas = nuevasPagas;
    await loadGastos(); // Recargar para que aparezca en el dash
    d.cuotas_pagas = getCuotasPagasDeuda(d);
    renderDeudas();
    renderDash();
  } catch (error) {
    showToast('Error al procesar pago: ' + error.message, 'err');
  }
}

function getCuotasPagasDeuda(deuda) {
  // Cuenta cuántas cuotas ya quedaron cubiertas por los pagos asociados
  // a esta deuda, sin depender del mes en que se hizo el pago.
  const pagos = (allGastos || []).filter(g => {
    if (!g) return false;
    const notas = String(g.notas || '');
    const desc = String(g.descripcion || '');
    return (g.categoria === 'Deudas' && (notas.includes(`Deuda ID: ${deuda.id}`) || desc.includes(`Deuda ID: ${deuda.id}`)));
  });

  if (pagos.length > 0) {
    const indices = pagos
      .map(g => {
        const desc = String(g.descripcion || '');
        const m = desc.match(/Pago\s*Cuota\s*(\d+)\s*\//i);
        return m && m[1] ? Number(m[1]) : null;
      })
      .filter(n => Number.isInteger(n));

    if (indices.length > 0) return Math.max(...indices);
    return pagos.length;
  }

  return Number(deuda.cuotas_pagas || 0);
}

function getIndicesCuotasPagas(deuda) {
  const pagos = (allGastos || []).filter(g => {
    if (!g) return false;
    const notas = String(g.notas || '');
    const desc = String(g.descripcion || '');
    return (g.categoria === 'Deudas' && (notas.includes(`Deuda ID: ${deuda.id}`) || desc.includes(`Deuda ID: ${deuda.id}`)));
  });

  const indices = new Set();
  pagos.forEach(g => {
    const desc = String(g.descripcion || '');
    const m = desc.match(/Pago\s*Cuota\s*(\d+)\s*\//i);
    if (m && m[1]) indices.add(Number(m[1]));
  });
  return indices;
}

function getCuotaPendienteParaMes(deuda, yearMonth) {
  if (!deuda.mes_inicio) return false;
  const [y, m] = deuda.mes_inicio.split('-').map(Number);
  const inicio = new Date(y, m - 1, 1);
  const [ty, tm] = yearMonth.split('-').map(Number);
  const target = new Date(ty, tm - 1, 1);

  const diffMonths = (target.getFullYear() - inicio.getFullYear()) * 12 + (target.getMonth() - inicio.getMonth());
  if (diffMonths <= 0) return false;

  const cuotasTotal = deuda.cuotas_total || 1;
  const cuotaIndex = diffMonths;
  const cuotasPagas = getCuotasPagasDeuda(deuda);

  return cuotaIndex <= cuotasTotal && cuotaIndex > cuotasPagas;
}

function getCuotasMes(yearMonth) {
  // yearMonth = 'YYYY-MM'
  return allDeudas.reduce((total, d) => {
    if (getCuotaPendienteParaMes(d, yearMonth)) {
      const montoARS = d.moneda === 'USD' ? d.monto_cuota * dolarHoy : d.monto_cuota;
      return total + parseFloat(montoARS || 0);
    }
    return total;
  }, 0);
}

// Devuelve el total de cuotas pendientes en un mes para una tarjeta específica
function getCuotasMesForTarjeta(yearMonth, tarjeta) {
  return allDeudas.reduce((total, d) => {
    if (d.tarjeta !== tarjeta) return total;
    if (getCuotaPendienteParaMes(d, yearMonth)) {
      const montoARS = d.moneda === 'USD' ? d.monto_cuota * dolarHoy : d.monto_cuota;
      return total + parseFloat(montoARS || 0);
    }
    return total;
  }, 0);
}



function getProxVencimiento(tarjeta) {
  const cfg = tarjetasCfg.find(t => t.tarjeta === tarjeta);
  if (!cfg) return { label: 'Sin config', color: 'var(--text3)' };
  
  const hoy = new Date();
  const dia = hoy.getDate();
  const mes = hoy.getMonth();
  const anio = hoy.getFullYear();
  
  // Si hoy es antes o el mismo día del cierre, el resumen cierra este mes
  // Si es después, ya estamos consumiendo para el próximo mes
  let fechaCierre;
  if (dia <= cfg.dia_cierre) {
    fechaCierre = new Date(anio, mes, cfg.dia_cierre);
  } else {
    fechaCierre = new Date(anio, mes + 1, cfg.dia_cierre);
  }
  
  const diffMs = fechaCierre - hoy;
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return { label: 'CIERRA HOY', color: 'var(--red)' };
  if (diffDays <= 3) return { label: `Cierra en ${diffDays}d`, color: 'var(--red)' };
  return { label: `Cierra en ${diffDays}d`, color: 'var(--green)' };
}

function renderDeudas() {
  const activas = allDeudas.filter(d => getCuotasPagasDeuda(d) < (d.cuotas_total||1));
  const terminadas = allDeudas.filter(d => getCuotasPagasDeuda(d) >= (d.cuotas_total||1));

  // ── Resumen por tarjeta ──
  const tarjetas = getTarjetas();
  const resDiv = document.getElementById('deu-resumen');
  const porTarjeta = {};
  tarjetas.forEach(t => { porTarjeta[t] = { ars:0, usd:0, count:0 }; });
  activas.forEach(d => {
    if (porTarjeta[d.tarjeta]) {
      porTarjeta[d.tarjeta].count++;
      if (d.moneda === 'USD') porTarjeta[d.tarjeta].usd += parseFloat(d.monto_cuota||0);
      else porTarjeta[d.tarjeta].ars += parseFloat(d.monto_cuota||0);
    } else {
      porTarjeta[d.tarjeta] = { ars:0, usd:0, count:1 };
      if (d.moneda === 'USD') porTarjeta[d.tarjeta].usd = parseFloat(d.monto_cuota||0);
      else porTarjeta[d.tarjeta].ars = parseFloat(d.monto_cuota||0);
      if(!tarjetas.includes(d.tarjeta)) tarjetas.push(d.tarjeta);
    }
  });
  const tarjetasConDeuda = tarjetas.filter(t => porTarjeta[t] && porTarjeta[t].count > 0);
  if (tarjetasConDeuda.length === 0) {
    resDiv.innerHTML = '<div class="empty" style="padding:1rem 0"><div class="empty-icon">💳</div>Sin deudas activas</div>';
  } else {
    resDiv.innerHTML = '<div class="card" style="margin-bottom:10px"><div class="card-title">Cuota mensual por tarjeta</div>' +
      tarjetasConDeuda.map(t => {
        const info = porTarjeta[t];
        const cfg = tarjetasCfg.find(c => c.tarjeta === t);
        const color = (cfg && cfg.color) ? cfg.color : (TARJETA_COLORS[t] || '#666');
        let montos = [];
        if (info.ars > 0) montos.push('<strong>$'+info.ars.toLocaleString('es-AR',{minimumFractionDigits:2})+'</strong>');
        if (info.usd > 0) montos.push('<strong>U$D '+info.usd.toLocaleString('es-AR',{minimumFractionDigits:2})+'</strong>');
        return `<div class="resumen-tarjeta">
          <span style="display:flex;align-items:center;gap:8px">
            <span class="tarjeta-badge" style="background:${color};color:white;width:90px;justify-content:center">${t}</span>
            <span style="font-size:12px;color:var(--text2)">${info.count} compra${info.count>1?'s':''}</span>
          </span>
          <span style="font-size:14px">${montos.join(' + ')}/mes</span>
        </div>`;
      }).join('') + '</div>';
  }

  // ── Gráfico próximos 12 meses ──
  const grafCard = document.getElementById('deu-grafico-card');
  if (activas.length > 0) {
    grafCard.style.display = 'block';
    const now = new Date();
    // Construir una serie por tarjeta con sus 12 meses
    const datasets = tarjetasConDeuda.map(t => {
      const cfg = tarjetasCfg.find(c => c.tarjeta === t);
      const color = (cfg && cfg.color) ? cfg.color : (TARJETA_COLORS[t] || '#666');
      const mesesData = [];
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth()+i, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        const totalARS = getCuotasMesForTarjeta(ym, t);
        const total = prefMoneda === 'USD' ? (totalARS / dolarHoy) : totalARS;
        const label = `${MESES_SHORT[d.getMonth()]} ${d.getFullYear().toString().slice(-2)}`;
        mesesData.push({ label, value: total });
      }
      return { label: t, data: mesesData, color };
    });

    document.getElementById('deu-grafico').innerHTML =
      '<div class="chart-container" style="height:150px"><canvas id="deuChart"></canvas></div>';
    const ctx = document.getElementById('deuChart');
    deuChart = drawLineChart(ctx, deuChart, datasets, { style: 'metrics' });
    deuChart = drawLineChart(ctx, deuChart, datasets);
  } else {
    grafCard.style.display = 'none';
  }

  // ── Lista de deudas ──
  const lista = document.getElementById('deu-lista');
  if (allDeudas.length === 0) {
    lista.innerHTML = '<div class="empty"><div class="empty-icon">🎉</div>Sin compras en cuotas</div>';
    return;
  }
  lista.innerHTML = [...activas, ...terminadas].map(d => {
    const pagas = getCuotasPagasDeuda(d);
    const total = d.cuotas_total || 1;
    const pct = Math.round(pagas/total*100);
    const terminada = pagas >= total;
    const cfg = tarjetasCfg.find(c => c.tarjeta === d.tarjeta);
    const color = (cfg && cfg.color) ? cfg.color : (TARJETA_COLORS[d.tarjeta] || '#888');
    const [y,m] = (d.mes_inicio||'').split('-');
    const inicioLabel = m && y ? `${MESES_SHORT[parseInt(m)-1]} ${y}` : '';
    const venc = getProxVencimiento(d.tarjeta);
    return `<div class="deu-item" style="${terminada?'opacity:0.5':''}">
      <div class="deu-ico" style="background:${color}22">💳</div>
      <div class="deu-info">
        <div class="deu-desc">${d.descripcion||''}</div>
        <div class="deu-meta">
          <span class="tarjeta-badge" style="background:${color};color:white">${d.tarjeta}</span>
          · <span style="color:${venc.color};font-weight:700;font-size:10px">${venc.label}</span>
          <br>${d.persona} · ${inicioLabel}
          ${d.notas ? `<br><span style="font-size:10px">${d.notas}</span>` : ''}
        </div>
        <div class="deu-progress"><div class="deu-progress-fill" style="width:${pct}%;background:${color}"></div></div>
        <div style="font-size:10px;color:var(--text2);margin-top:3px">${pagas}/${total} cuotas pagadas</div>
      </div>
      <div class="deu-right">
        <div class="deu-monto">${fmtDeuda(d.monto_cuota, d.moneda)}</div>
        <div class="deu-cuota" style="font-size:10px">Total: ${fmtDeuda(d.monto_total, d.moneda).split('<br>')[0]}</div>
        ${!terminada ? `<button class="btn btn-sm" onclick="pagarCuota('${d.id}')" style="margin-top:6px;padding:4px 8px;font-size:11px">✓ Pagar cuota</button>` : '<div style="font-size:11px;color:var(--green);margin-top:4px;font-weight:600">✓ Pagado</div>'}
        <button class="btn btn-danger btn-sm" onclick="deleteDeuda('${d.id}')" style="margin-top:4px;padding:3px 7px;font-size:11px">🗑</button>
      </div>
    </div>`;

  }).join('');
}

// ─── EVOLUCIÓN (CHART) ───────────────────────────────────────────────────────
let evoChart = null;
let deuChart = null;
let metEvoChart = null;
let msMetCatSel = new Set();

function renderEvolutionChart() {
  const ctx = document.getElementById('evolutionChart');
  if (!ctx) return;
  
  const data = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const totalARS = allGastos
      .filter(g => g.fecha && g.fecha.startsWith(ym))
      .reduce((s, g) => {
        const m = parseFloat(g.monto || 0);
        return s + (g.moneda === 'USD' ? m * dolarHoy : m);
      }, 0);
    const total = prefMoneda === 'USD' ? (totalARS / dolarHoy) : totalARS;
    data.push({ label: `${MESES_SHORT[d.getMonth()]} ${d.getFullYear().toString().slice(-2)}`, value: total });
  }

  if (evoChart) evoChart.destroy();
  evoChart = drawLineChart(ctx, evoChart, [{ label: 'Gastos', data: data, color: '#1D9E75' }]);
}

function renderMetrics() {
  const ctx = document.getElementById('metEvolutionChart');
  if (!ctx) return;
  
  buildMsMetCat();
  
  const catsToShow = msMetCatSel.size > 0 ? Array.from(msMetCatSel) : categorias.slice().sort((a,b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })).map(c => c.nombre);
  const datasets = getEvolutionDataByCategory(catsToShow, 3);
  
  if (metEvoChart) metEvoChart.destroy();
  
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  const textColor = isDark ? '#9b9896' : '#6b6966';

  metEvoChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: datasets[0].labels,
      datasets: datasets.map(ds => ({
        label: ds.label,
        data: ds.values,
        borderColor: ds.color,
        backgroundColor: ds.color + '11',
        fill: false,
        tension: 0,
        borderWidth: 3,
        pointRadius: 2,
        pointHoverRadius: 4,
        borderDash: (ctx) => ctx.index >= (datasets[0].labels.length - 2) ? [5, 5] : [], // Punteado para las proyecciones
        segment: {
          borderDash: (ctx) => ctx.p0DataIndex >= (datasets[0].labels.length - 3) ? [5, 5] : []
        }
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { 
        legend: { 
          display: true, 
          position: 'top',
          labels: { color: textColor, font: { size: 10 }, boxWidth: 10 }
        }, 
        tooltip: { 
          mode: 'index', 
          intersect: false,
          callbacks: {
            label: function(ctx) {
              const isProj = ctx.dataIndex === (ctx.dataset.data.length - 1);
              return ctx.dataset.label + ': ' + (prefMoneda === 'USD' ? 'U$D ' : '$') + ctx.parsed.y.toLocaleString('es-AR') + (isProj ? ' (Proj)' : '');
            }
          }
        } 
      },
      scales: {
        y: { 
          display: true, 
          beginAtZero: true,
          grid: { color: gridColor },
          ticks: { 
            color: textColor, 
            font: { size: 9 },
            callback: function(val) {
              if (val >= 1000000) return (val/1000000).toFixed(1) + 'M';
              if (val >= 1000) return (val/1000).toFixed(0) + 'k';
              return val;
            }
          }
        },
        x: { grid: { display: false }, ticks: { color: textColor, font: { size: 10 } } }
      }
    }
  });
  
  renderMetricsStats();
}

function buildMsMetCat() {
  const items = categorias.slice().sort((a,b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })).map(c => c.nombre);
  const el = document.getElementById('ms-met-cat');
  if (!el) return;
  el.innerHTML =
    `<div class="ms-item" onclick="msMetCatToggle('__all__')">
      <div class="ms-check ${msMetCatSel.size === 0 ? 'on' : ''}"></div>
      <span style="font-weight:600">Todas</span>
    </div>` +
    items.map(item =>
      `<div class="ms-item" onclick="msMetCatToggle('${item}');event.stopPropagation()">
        <div class="ms-check ${msMetCatSel.has(item) ? 'on' : ''}"></div>
        <span>${item}</span>
      </div>`
    ).join('');
  const lbl = document.getElementById('ms-met-cat-label');
  if (msMetCatSel.size === 0) lbl.textContent = 'Todas';
  else if (msMetCatSel.size === 1) lbl.textContent = Array.from(msMetCatSel)[0];
  else lbl.textContent = `${msMetCatSel.size} categorías`;
}

function msMetCatToggle(val, event) {
  if (event) event.stopPropagation();
  if (val === '__all__') msMetCatSel.clear();
  else {
    if (msMetCatSel.has(val)) msMetCatSel.delete(val);
    else msMetCatSel.add(val);
  }
  buildMsMetCat();
  renderMetrics();
}

function getEvolutionDataByCategory(cats, months) {
  const datasets = [];
  const now = new Date();
  const labels = [];
  const ymKeys = []; // YYYY-MM para filtrar fechas en DB
  
  // Etiquetas: meses anteriores (2)
  for (let i = 2; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    labels.push(`${MESES_SHORT[d.getMonth()]} ${d.getFullYear()}`);
    ymKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  // Mes actual (1)
  labels.push(`${MESES_SHORT[now.getMonth()]} ${now.getFullYear()}`);
  ymKeys.push(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  
  // Meses proyección (2)
  for (let i = 1; i <= 2; i++) {
    const projDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
    labels.push(`${MESES_SHORT[projDate.getMonth()]} ${projDate.getFullYear()} (Proy.)`);
    ymKeys.push(null); // placeholder
  }

  cats.forEach(catName => {
    const values = [];
    const cInfo = categorias.find(c => c.nombre === catName) || { color: '#888' };
    
    // Valores reales (excluye las 2 proyecciones)
    const numRealMonths = 3; // 2 pasados + 1 actual
    for (let i = 0; i < numRealMonths; i++) {
      const ym = ymKeys[i];
      const total = allGastos
        .filter(g => g.categoria === catName && g.fecha && g.fecha.startsWith(ym))
        .reduce((s, g) => {
          const m = parseFloat(g.monto || 0);
          const mARS = g.moneda === 'USD' ? m * dolarHoy : m;
          return s + (prefMoneda === 'USD' ? mARS / dolarHoy : mARS);
        }, 0);
      values.push(total);
    }
    
    // Proyección: promedio de los meses reales mostrados
    const avg = values.reduce((s, v) => s + v, 0) / (values.length);
    values.push(avg); // Proy 1
    values.push(avg); // Proy 2
    
    datasets.push({
      label: catName,
      labels: labels,
      values: values,
      color: cInfo.color
    });
  });
  
  return datasets;
}

function drawLineChart(ctx, chartInstance, datasets, opts) {

  if (chartInstance) chartInstance.destroy();
  
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  const textColor = isDark ? '#9b9896' : '#6b6966';

    return new Chart(ctx, {
    type: 'line',
    data: {
      labels: datasets[0].data.map(m => m.label),
      datasets: datasets.map(ds => {
        const isMetrics = (typeof opts !== 'undefined' && opts.style === 'metrics');
        const labelCount = datasets[0] && datasets[0].data ? datasets[0].data.length : 0;
        return Object.assign({
          label: ds.label,
          data: ds.data.map(m => m.value),
          borderColor: ds.color,
          backgroundColor: ds.color + '11',
          tension: 0,
          borderWidth: 3
        }, isMetrics ? {
          fill: false,
          pointRadius: 4,
          pointHoverRadius: 4,
          pointBackgroundColor: ds.color,
          pointBorderColor: ds.color,
          pointBorderWidth: 0,
          borderDash: (ctx) => ctx.index >= (labelCount - 2) ? [5, 5] : [],
          segment: { borderDash: (ctx) => ctx.p0DataIndex >= (labelCount - 3) ? [5,5] : [] }
        } : {
          // Restaurar estilo por defecto: puntos pequeños, rellenos y del color de la serie
          fill: true,
          pointRadius: 2,
          pointStyle: 'circle',
          pointBackgroundColor: ds.color,
          pointBorderColor: ds.color,
          pointBorderWidth: 0,
          pointHoverRadius: 4
        });
      })
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { 
        legend: { display: datasets.length > 1, labels: (typeof opts !== 'undefined' && opts.style === 'metrics') ? { color: textColor, font: { size: 10 }, boxWidth: 10 } : { color: textColor, usePointStyle: true, boxWidth: 20 } }, 
        tooltip: { 
          mode: 'index', 
          intersect: false,
          callbacks: {
            label: function(ctx) {
              return ctx.dataset.label + ': ' + (prefMoneda === 'USD' ? 'U$D ' : '$') + ctx.parsed.y.toLocaleString('es-AR');
            }
          }
        } 
      },
      scales: {
        y: { 
          display: true, 
          beginAtZero: true,
          grid: { color: gridColor },
          ticks: { 
            color: textColor, 
            font: { size: 9 },
            callback: function(val) {
              if (val >= 1000000) return (val/1000000).toFixed(1) + 'M';
              if (val >= 1000) return (val/1000).toFixed(0) + 'k';
              return val;
            }
          }
        },
        x: { grid: { display: false }, ticks: { color: textColor, font: { size: 10 } } }
      }
    }
  });
}

function renderMetricsStats() {
  const now = new Date();
  const ymCurrent = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const ymPrev = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;

  const getMontoARS = (g) => {
    const m = parseFloat(g.monto || 0);
    return g.moneda === 'USD' ? m * dolarHoy : m;
  };

  const filterByCat = (g) => msMetCatSel.size === 0 || msMetCatSel.has(g.categoria);

  const totalCurrent = allGastos
    .filter(g => g.fecha && g.fecha.startsWith(ymCurrent) && filterByCat(g))
    .reduce((s, g) => s + getMontoARS(g), 0);
    
  const totalPrev = allGastos
    .filter(g => g.fecha && g.fecha.startsWith(ymPrev) && filterByCat(g))
    .reduce((s, g) => s + getMontoARS(g), 0);
  
  const diff = totalPrev > 0 ? ((totalCurrent - totalPrev) / totalPrev * 100) : 0;
  const diffText = totalPrev > 0 ? `${diff > 0 ? '+' : ''}${diff.toFixed(1)}% vs mes ant.` : 'N/A';
  const diffColor = diff > 0 ? 'var(--red)' : 'var(--green)';

  const avg3 = allGastos.filter(g => {
    const d = new Date(g.fecha);
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    return d >= threeMonthsAgo && filterByCat(g);
  }).reduce((s, g) => s + getMontoARS(g), 0) / 3;

  document.getElementById('met-stats-grid').innerHTML = `
    <div class="metric">
      <div class="metric-label">Gasto Mes Actual ${msMetCatSel.size > 0 ? '(Filtrado)' : ''}</div>
      <div class="metric-value">${fmt(totalCurrent)}</div>
      <div style="font-size:10px; color:${diffColor}; font-weight:700; margin-top:4px">${diffText}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Promedio (Últ. 3 meses)</div>
      <div class="metric-value">${fmt(avg3)}</div>
    </div>
  `;

  // Top categorías (siempre basado en lo seleccionado)
  const catMap = {};
  allGastos.filter(g => {
    const d = new Date(g.fecha);
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    return d >= threeMonthsAgo && filterByCat(g);
  }).forEach(g => {
    catMap[g.categoria] = (catMap[g.categoria] || 0) + getMontoARS(g);
  });

  const top = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  document.getElementById('met-top-cats').innerHTML = top.map(([cat, val]) => `
    <div class="cat-row">
      <div class="cat-row-head">
        <span class="cat-name"><span class="cat-dot" style="background:${catColor(cat)}"></span>${cat}</span>
        <span class="cat-val">${fmt(val/3)}/mes</span>
      </div>
      <div class="bar-bg">
        <div class="bar-fill" style="width:${(val / (top[0][1] || 1) * 100)}%;background:${catColor(cat)}"></div>
      </div>
    </div>
  `).join('') || '<div class="empty">Sin datos suficientes</div>';
}

// ─── RECURRENTES ─────────────────────────────────────────────────────────────
async function loadRecurrentes() {
  const { data, error } = await sb.from('recurrentes').select('*').order('descripcion');
  if (data) allRecurrentes = data;
}

function renderRecurrentes() {
  const el = document.getElementById('rec-lista');
  if (allRecurrentes.length === 0) {
    el.innerHTML = '<div class="rec-empty">No tenés gastos fijos configurados todavía.</div>';
    return;
  }

  // Detectar qué recurrentes ya fueron cargados este mes
  const ym = `${dashMonth.getFullYear()}-${String(dashMonth.getMonth() + 1).padStart(2, '0')}`;
  const gastosMes = allGastos.filter(g => g.fecha && g.fecha.startsWith(ym));

  el.innerHTML = allRecurrentes.map(r => {
    const yaCargado = gastosMes.some(g => g.descripcion === r.descripcion && g.categoria === r.categoria);
    return `
    <div class="rec-item">
      <div class="tx-dot" style="background:${catColor(r.categoria)}22">${catEmoji(r.categoria)}</div>
      <div class="rec-info">
        <div class="rec-name">${r.descripcion}</div>
        <div class="rec-meta">${r.categoria} · ${personaBadge(r.persona)} · <strong>${r.moneda === 'USD' ? 'U$D ' : '$'}${parseFloat(r.monto).toLocaleString('es-AR')}</strong></div>
      </div>
      <div class="rec-actions">
        ${yaCargado 
          ? '<span style="color:var(--green);font-size:12px;font-weight:700;margin-right:8px">Cargado ✓</span>'
          : `<button class="btn btn-primary btn-sm" onclick="cargarGastoRecurrente('${r.id}')">Cargar</button>`
        }
        <button class="btn btn-danger btn-sm" onclick="deleteRecurrente('${r.id}')">🗑</button>
      </div>
    </div>`;
  }).join('');
}

function showFormRec() {
  document.getElementById('rf-cat').innerHTML = categorias.map(c => `<option value="${c.nombre}">${c.nombre}</option>`).join('');
  document.getElementById('rf-persona').innerHTML = usuarios.map(u => `<option value="${u.name}">${u.name}</option>`).join('') + '<option value="Ambos">Ambos</option>';
  document.getElementById('rf-moneda').value = prefMoneda;
  
  // Federico por defecto
  const personaSelect = document.getElementById('rf-persona');
  const currentProfile = usuarios.find(u => u.id === currentUser.id);
  if (currentProfile) personaSelect.value = currentProfile.name;

  document.getElementById('rec-form').style.display = 'block';
  document.getElementById('rec-form').scrollIntoView({ behavior: 'smooth' });
}


function hideFormRec() {
  document.getElementById('rec-form').style.display = 'none';
  ['rf-desc', 'rf-monto'].forEach(id => document.getElementById(id).value = '');
}


async function saveRecurrente() {
  const desc = document.getElementById('rf-desc').value.trim();
  const monto = parseInputFloat(document.getElementById('rf-monto').value);
  const cat = document.getElementById('rf-cat').value;
  const persona = document.getElementById('rf-persona').value;
  const moneda = document.getElementById('rf-moneda').value;

  if (!desc || isNaN(monto) || monto <= 0) { showToast('Completá los datos correctamente', 'err'); return; }

  const btn = document.getElementById('rf-save-btn');
  btn.innerHTML = '<span class="spinner"></span>'; btn.classList.add('btn-loading');

  const item = { descripcion: desc, monto, categoria: cat, persona, moneda, user_id: currentUser.id, user_email: currentUser.email };
  
  try {
    const { data, error } = await sbWithTimeout(() => sb.from('recurrentes').insert([item]).select());
    if (error) throw error;
    if (data && data[0]) allRecurrentes.push(data[0]);
    hideFormRec();
    renderRecurrentes();
    showToast('Gasto fijo guardado ✓');
  } catch (error) {
    showToast('Error: ' + error.message, 'err');
  } finally {
    btn.innerHTML = 'Guardar'; btn.classList.remove('btn-loading');
  }
}

async function deleteRecurrente(id) {
  if (!confirm('¿Eliminar este gasto fijo?')) return;
  try {
    const { error } = await sbWithTimeout(() => sb.from('recurrentes').delete().eq('id', id));
    if (error) throw error;
    allRecurrentes = allRecurrentes.filter(r => r.id !== id);
    renderRecurrentes();
    showToast('Gasto fijo eliminado');
  } catch (error) {
    showToast('Error al eliminar: ' + error.message, 'err');
  }
}

async function cargarGastoRecurrente(id) {
  const r = allRecurrentes.find(x => x.id === id);
  if (!r) return;

  const hoy = new Date();
  const fecha = `${dashMonth.getFullYear()}-${String(dashMonth.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  
  const gasto = { 
    fecha, 
    monto: r.monto, 
    categoria: r.categoria, 
    persona: r.persona, 
    descripcion: r.descripcion, 
    moneda: r.moneda || 'ARS',
    notas: 'Carga automática (Fijo)',
    user_id: currentUser.id, 
    user_email: currentUser.email 
  };

  showToast('Cargando...', 'info');
  try {
    const { error } = await sbWithTimeout(() => sb.from('gastos').insert([gasto]));
    if (error) throw error;
    await loadGastos();
    renderRecurrentes();
    showToast('Gasto cargado al mes actual ✓');
  } catch (error) {
    showToast('Error: ' + error.message, 'err');
  }
}

async function cargarTodosRecurrentes() {
  const ym = `${dashMonth.getFullYear()}-${String(dashMonth.getMonth() + 1).padStart(2, '0')}`;
  const gastosMes = allGastos.filter(g => g.fecha && g.fecha.startsWith(ym));
  const pendientes = allRecurrentes.filter(r => !gastosMes.some(g => g.descripcion === r.descripcion && g.categoria === r.categoria));

  if (pendientes.length === 0) { showToast('No hay gastos fijos pendientes este mes', 'info'); return; }

  const btn = document.getElementById('btn-cargar-todo');
  btn.innerHTML = '<span class="spinner"></span> Cargando...'; btn.classList.add('btn-loading');

  const hoy = new Date();
  const fecha = `${dashMonth.getFullYear()}-${String(dashMonth.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;

  const nuevos = pendientes.map(r => ({
    fecha, monto: r.monto, categoria: r.categoria, persona: r.persona, 
    descripcion: r.descripcion, moneda: r.moneda || 'ARS',
    notas: 'Carga automática masiva', user_id: currentUser.id, user_email: currentUser.email 
  }));

  try {
    const { error } = await sbWithTimeout(() => sb.from('gastos').insert(nuevos));
    if (error) throw error;
    await loadGastos();
    renderRecurrentes();
    showToast(`Se cargaron ${nuevos.length} gastos fijos ✓`);
  } catch (error) {
    showToast('Error: ' + error.message, 'err');
  } finally {
    btn.innerHTML = 'Cargar todo'; btn.classList.remove('btn-loading');
  }
}

// ─── BALANCE E INGRESOS ─────────────────────────────────────────────────────
let allIngresos = [];

async function loadIngresos() {
  const { data } = await sb.from('ingresos').select('*').order('fecha', { ascending: false });
  if (data) allIngresos = data;
}

function showFormIngreso() {
  document.getElementById('bal-form').style.display = 'block';
  document.getElementById('i-fecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('i-moneda').value = prefMoneda;
  document.getElementById('i-desc').value = '';
  document.getElementById('i-monto').value = '';
  document.getElementById('i-desc').focus();
}

function hideFormIngreso() {
  document.getElementById('bal-form').style.display = 'none';
}

async function saveIngreso() {
  const desc = document.getElementById('i-desc').value.trim();
  const monto = parseInputFloat(document.getElementById('i-monto').value);
  const moneda = document.getElementById('i-moneda').value;
  const fecha = document.getElementById('i-fecha').value;
  if (!desc || isNaN(monto) || !fecha) { showToast('Completá los datos', 'err'); return; }
  const btn = document.getElementById('i-save-btn');
  btn.innerHTML = '<span class="spinner"></span>'; btn.classList.add('btn-loading');
  try {
    const { error } = await sbWithTimeout(() => sb.from('ingresos').insert([{ descripcion: desc, monto, moneda, fecha, user_id: currentUser.id }]));
    if (error) throw error;
    showToast('Ingreso guardado ✓'); 
    hideFormIngreso(); 
    await loadIngresos(); 
    renderBalance();
  } catch (error) {
    showToast('Error: ' + error.message, 'err');
  } finally {
    btn.innerHTML = 'Guardar'; btn.classList.remove('btn-loading');
  }
}

function renderBalance() {
  const ym = `${dashMonth.getFullYear()}-${String(dashMonth.getMonth() + 1).padStart(2, '0')}`;
  const ingMes = allIngresos.filter(i => i.fecha && i.fecha.startsWith(ym));
  const gastMes = allGastos.filter(g => g.fecha && g.fecha.startsWith(ym));
  const getMontoARS = (val, mon) => mon === 'USD' ? val * dolarHoy : val;
  const totalIng = ingMes.reduce((s, i) => s + getMontoARS(i.monto, i.moneda), 0);
  const totalGast = gastMes.reduce((s, g) => s + getMontoARS(g.monto, g.moneda), 0);
  const neto = totalIng - totalGast;
  document.getElementById('bal-summary').innerHTML = `
    <div class="metric">
      <div class="metric-label">Ingresos</div>
      <div class="metric-value g">${fmt(totalIng)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Gastos</div>
      <div class="metric-value r">${fmt(totalGast)}</div>
    </div>
    <div class="metric" style="grid-column:1/-1">
      <div class="metric-label">Balance Neto (Sobrante)</div>
      <div class="metric-value ${neto >= 0 ? 'g' : 'r'}">${fmt(neto)}</div>
    </div>`;
  document.getElementById('bal-ingresos-list').innerHTML = ingMes.length 
    ? ingMes.map(i => `
      <div class="tx-item">
        <div class="tx-dot" style="background:var(--green)22">💰</div>
        <div class="tx-info">
          <div class="tx-desc">${i.descripcion}</div>
          <div class="tx-meta">${fdate(i.fecha)}</div>
        </div>
        <div class="tx-right">
          <div class="tx-amount" style="color:var(--green)">${fmtGasto(i.monto, i.moneda)}</div>
          <button class="btn btn-danger btn-sm" onclick="deleteIngreso('${i.id}')" style="margin-top:4px;padding:2px 6px">🗑</button>
        </div>
      </div>`).join('')
    : '<div class="empty">Sin ingresos este mes</div>';
}

async function deleteIngreso(id) {
  if (!confirm('¿Eliminar ingreso?')) return;
  try {
    const { error } = await sbWithTimeout(() => sb.from('ingresos').delete().eq('id', id));
    if (error) throw error;
    await loadIngresos();
    renderBalance();
    showToast('Ingreso eliminado ✓');
  } catch (error) {
    showToast('Error al eliminar: ' + error.message, 'err');
  }
}

// ─── AHORROS ─────────────────────────────────────────────────────────
let allAhorros = [];

async function loadAhorros() {
  const { data } = await sb.from('ahorros').select('*').order('fecha', { ascending: false });
  if (data) allAhorros = data;
}

function showFormAhorro() {
  document.getElementById('aho-form').style.display = 'block';
  document.getElementById('a-fecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('a-moneda').value = prefMoneda;
  document.getElementById('a-desc').value = '';
  document.getElementById('a-monto').value = '';
  document.getElementById('a-desc').focus();
}

function hideFormAhorro() {
  document.getElementById('aho-form').style.display = 'none';
}

async function saveAhorro() {
  const desc = document.getElementById('a-desc').value.trim();
  const monto = parseInputFloat(document.getElementById('a-monto').value);
  const moneda = document.getElementById('a-moneda').value;
  const fecha = document.getElementById('a-fecha').value;
  if (!desc || isNaN(monto) || !fecha) { showToast('Completá los datos', 'err'); return; }
  const btn = document.getElementById('a-save-btn');
  btn.innerHTML = '<span class="spinner"></span>'; btn.classList.add('btn-loading');
  try {
    const { error } = await sbWithTimeout(() => sb.from('ahorros').insert([{ descripcion: desc, monto, moneda, fecha, user_id: currentUser.id }]));
    if (error) throw error;
    showToast('Ahorro guardado ✓'); 
    hideFormAhorro(); 
    await loadAhorros(); 
    renderAhorros();
  } catch (error) {
    showToast('Error: ' + error.message, 'err');
  } finally {
    btn.innerHTML = 'Guardar'; btn.classList.remove('btn-loading');
  }
}

function renderAhorros() {
  const ym = `${dashMonth.getFullYear()}-${String(dashMonth.getMonth() + 1).padStart(2, '0')}`;
  const ahoMes = allAhorros.filter(a => a.fecha && a.fecha.startsWith(ym));
  const getMontoARS = (val, mon) => mon === 'USD' ? val * dolarHoy : val;
  const totalAho = ahoMes.reduce((s, a) => s + getMontoARS(a.monto, a.moneda), 0);
  document.getElementById('aho-summary').innerHTML = `
    <div class="metric" style="grid-column:1/-1">
      <div class="metric-label">Total Ahorrado en el Mes</div>
      <div class="metric-value g">${fmt(totalAho)}</div>
    </div>`;
  document.getElementById('aho-list').innerHTML = ahoMes.length 
    ? ahoMes.map(a => `
      <div class="tx-item">
        <div class="tx-dot" style="background:var(--green)22">🏦</div>
        <div class="tx-info">
          <div class="tx-desc">${a.descripcion}</div>
          <div class="tx-meta">${fdate(a.fecha)}</div>
        </div>
        <div class="tx-right">
          <div class="tx-amount" style="color:var(--green)">${fmtGasto(a.monto, a.moneda)}</div>
          <button class="btn btn-danger btn-sm" onclick="deleteAhorro('${a.id}')" style="margin-top:4px;padding:2px 6px">🗑</button>
        </div>
      </div>`).join('')
    : '<div class="empty">Sin ahorros este mes</div>';
}

async function deleteAhorro(id) {
  if (!confirm('¿Eliminar ahorro?')) return;
  try {
    const { error } = await sbWithTimeout(() => sb.from('ahorros').delete().eq('id', id));
    if (error) throw error;
    await loadAhorros();
    renderAhorros();
    showToast('Ahorro eliminado ✓');
  } catch (error) {
    showToast('Error al eliminar: ' + error.message, 'err');
  }
}

// ─── METAS DE AHORRO ─────────────────────────────────────────────────────────
let allMetas = [];
async function loadGoals() {
  const { data } = await sb.from('metas').select('*').order('created_at');
  if (data) allMetas = data;
}
function showFormMeta() {
  document.getElementById('goal-form').style.display = 'block';
  document.getElementById('g-moneda').value = prefMoneda;
}
function hideFormMeta() {
  document.getElementById('goal-form').style.display = 'none';
}
async function saveMeta() {
  const desc = document.getElementById('g-desc').value.trim();
  const target = parseInputFloat(document.getElementById('g-target').value);
  const current = parseInputFloat(document.getElementById('g-current').value || 0);
  const moneda = document.getElementById('g-moneda').value;
  if (!desc || isNaN(target)) { showToast('Completá los datos', 'err'); return; }
  
  const btn = document.getElementById('g-save-btn');
  if (btn) { btn.innerHTML = '<span class="spinner"></span>'; btn.classList.add('btn-loading'); }
  
  try {
    const { error } = await sbWithTimeout(() => sb.from('metas').insert([{ descripcion: desc, monto_objetivo: target, monto_actual: current, moneda, user_id: currentUser.id }]));
    if (error) throw error;
    showToast('Meta creada ✓'); 
    hideFormMeta(); 
    await loadGoals(); 
    renderGoals();
  } catch (error) {
    showToast('Error: ' + error.message, 'err');
  } finally {
    if (btn) { btn.innerHTML = 'Guardar'; btn.classList.remove('btn-loading'); }
  }
}
function renderGoals() {
  const el = document.getElementById('goals-list');
  el.innerHTML = allMetas.length 
    ? allMetas.map(m => {
        const pct = Math.min(Math.round((m.monto_actual / m.monto_objetivo) * 100), 100);
        return `
        <div class="deu-card">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px">
            <span style="font-weight:700">${m.descripcion}</span>
            <span style="font-size:12px;color:var(--text2)">${pct}%</span>
          </div>
          <div class="deu-progress"><div class="deu-progress-fill" style="width:${pct}%;background:var(--green)"></div></div>
          <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:12px">
            <span>${fmtGasto(m.monto_actual, m.moneda)}</span>
            <span style="color:var(--text3)">Meta: ${fmtGasto(m.monto_objetivo, m.moneda)}</span>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn btn-sm" style="flex:1" onclick="updateMetaMonto('${m.id}')">Actualizar</button>
            <button class="btn btn-danger btn-sm" onclick="deleteMeta('${m.id}')">🗑</button>
          </div>
        </div>`;
      }).join('')
    : '<div class="empty">No tienes metas de ahorro todavía.</div>';
}
async function updateMetaMonto(id) {
  const m = allMetas.find(x => x.id === id);
  const nuevo = prompt(`¿Cuánto tienes ahorrado ahora para "${m.descripcion}"?`, m.monto_actual);
  if (nuevo === null) return;
  const val = parseInputFloat(nuevo);
  if (isNaN(val) || val < 0) return;
  try {
    const { error } = await sbWithTimeout(() => sb.from('metas').update({ monto_actual: val }).eq('id', id));
    if (error) throw error;
    await loadGoals();
    renderGoals();
    showToast('Meta actualizada ✓');
  } catch (error) {
    showToast('Error al actualizar meta: ' + error.message, 'err');
  }
}
async function deleteMeta(id) {
  if (!confirm('¿Eliminar meta?')) return;
  try {
    const { error } = await sbWithTimeout(() => sb.from('metas').delete().eq('id', id));
    if (error) throw error;
    await loadGoals();
    renderGoals();
    showToast('Meta eliminada');
  } catch (error) {
    showToast('Error al eliminar: ' + error.message, 'err');
  }
}
// ─── START ───────────────────────────────────────────────────────────────────

const now = new Date();
if (document.getElementById('r-mes')) {
  document.getElementById('r-mes').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
if (document.getElementById('r-desde') && document.getElementById('r-hasta')) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  document.getElementById('r-desde').value = `${y}-${m}-01`;
  document.getElementById('r-hasta').value = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
}
init();
