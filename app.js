
// =======================================================
// DATA
// =======================================================
const SKEY='riego_v1';
function defData(){
  return {
    nid:1,
    clientes:[],
    versiones:[],
    tipos:['Sensor de humedad (Mi Flora)','Sensor de nivel de reservorio','Sensor de temperatura (DS18B20)','Actuador de válvula','Sensor de caudal','Estación meteorológica'],
    presupuestos:[],
    componentes:[],
    movimientos:[],
    ordenes:[],
    fondos:[],
    proveedores:[],
    gestiones:[],
    fabricacion:[],
    instalaciones:[],
    mantenimientos:[],
    kit:[],
    kitinst:[],
    kitVersion:1,
    kitinstVersion:1,
    config:{
      empresa:'Riego Adaptativo',
      email:'',
      tel:'',
      direccion:'',
      web:'',
      firma:'Riego Adaptativo',
      tipoCambio:1,
      pdf_incluir_monto:true,
      pdf_incluir_sensores:true,
      pdf_incluir_condiciones:true,
      desc_AquaOne:'Sistema de riego automático básico con control remoto vía Telegram. Riego programado por horario y notificaciones en tiempo real.',
      desc_AquaDuo:'Suma sensor de humedad de suelo (Mi Flora) para ajustar el riego según la condición real de la tierra, no solo por horario.',
      desc_AquaTrio:'Suma protección antihelada: monitoreo de temperatura ambiente y activación preventiva ante riesgo de helada de irradiación.',
      desc_AquaPro:'Suma sensor de nivel de reservorio y lógica adaptativa completa: cruza humedad, temperatura y pronóstico para decidir cuándo regar.',
      desc_AquaMax:'Máxima prestación: múltiples zonas de riego independientes, historial extendido de ciclos y soporte prioritario.',
      motivosSalida:['Merma / descarte','Uso interno / prototipo','Garantía cliente','Reposición a cliente','Prueba de calidad','Devolución a proveedor','Rotura / daño'],
      origenesEntrada:['Compra','Devolución','Otro']
    }
  };
}

// Initialize DB from localStorage or defaults
let DB;
try {
  DB = JSON.parse(localStorage.getItem(SKEY));
  if(!DB || !DB.clientes) DB = defData();
} catch(e) {
  DB = defData();
}
// Migrate missing fields
if(!DB.presupuestos) DB.presupuestos = [];
if(!DB.componentes) DB.componentes = [];
if(!DB.movimientos) DB.movimientos = [];
if(!DB.ordenes) DB.ordenes = [];
if(!DB.proveedores) DB.proveedores = [];
if(!DB.gestiones) DB.gestiones = [];
if(!DB.fabricacion) DB.fabricacion = [];
if(!DB.instalaciones) DB.instalaciones = [];
if(!DB.mantenimientos) DB.mantenimientos = [];
if(!DB.kitinst) DB.kitinst = [];
if(!DB.config.motivosSalida) DB.config.motivosSalida = ['Merma / descarte','Uso interno / prototipo','Garantía cliente','Reposición a cliente','Prueba de calidad','Devolución a proveedor','Rotura / daño'];
if(!DB.config.origenesEntrada) DB.config.origenesEntrada = ['Compra','Devolución','Otro'];

// Migrate c.mant[] to DB.mantenimientos[]
(function migrarMantenimientos(){
  var ids = {};
  (DB.mantenimientos||[]).forEach(function(m){ if(m.numero) ids[m.numero]=true; });
  (DB.clientes||[]).forEach(function(c){
    (c.mant||[]).forEach(function(m){
      if(m.numero&&ids[m.numero]) return;
      var reg = Object.assign({},m,{
        clienteId: c.id,
        clienteNombre: c.nombre,
        modelo: c.modelo||''
      });
      if(!reg.numero) reg.numero = 'MNT-MIGR-'+c.id+'-'+(c.mant.indexOf(m));
      DB.mantenimientos.push(reg);
      if(m.numero) ids[m.numero]=true;
    });
  });
})();
if(!DB.kitinstVersion) DB.kitinstVersion = 1;
if(!DB.kitinstFecha) DB.kitinstFecha = today();
if(!DB.kit) DB.kit = [];
if(!DB.kitVersion) DB.kitVersion = 1;

// ===== DEV: Líneas de producto (reemplaza por completo el motor fijo ETAPAS_FAB / Zpro) =====
// Sin semilla: arranca vacío. El usuario define sus propias líneas de producto desde cero.
if(!DB.lineasProducto) DB.lineasProducto = [];
if(!DB.kitFecha) DB.kitFecha = today();
// Migrate ordenes - add numero if missing
DB.ordenes.forEach(function(o,i){
  if(!o.numero) o.numero = 'OC-'+( o.fecha?o.fecha.slice(0,4):new Date().getFullYear())+'-'+String(i+1).padStart(4,'0');
});
if(!DB.fondos) DB.fondos = [];
DB.clientes.forEach(function(c){
  if(!c.barrio) c.barrio='';
  if(!c.email) c.email='';
  if(!c.ambientes) c.ambientes='';
  if(!c.equipo) c.equipo={};
  if(!c.zigbee) c.zigbee=[];
  if(!c.ota) c.ota=[];
  if(!c.mant) c.mant=[];
});
DB.presupuestos.forEach(function(p){if(!p.email) p.email='';if(!p.ambientes) p.ambientes='';});
DB.componentes.forEach(function(c){if(!c.area) c.area='Fábrica';});

var _stockCache = null;
function _buildStockCache(){
  _stockCache = {};
  DB.movimientos.forEach(function(m){
    var cid = m.cid||m.compId;
    if(!cid) return;
    if(!_stockCache[cid]) _stockCache[cid]=0;
    _stockCache[cid] += m.tipo==='Entrada'?(parseFloat(m.cant)||0):-(parseFloat(m.cant)||0);
  });
}
function stockActual(cid){
  if(!_stockCache) _buildStockCache();
  return _stockCache[cid]||0;
}
function invalidarStockCache(){ _stockCache=null; }

function save(){
  invalidarStockCache();
  localStorage.setItem(SKEY,JSON.stringify(DB));
  if(window._vssFolderHandle) vssBackupEnCarpeta(window._vssFolderHandle);
  vssSyncDebounce();
  scheduleStockPush();
}

// =======================================================
// SYNC DE STOCK CON EL ESCÁNER (componentes + movimientos, por EAN)
// Carpeta de Drive "RiegoAdaptativoStock" — puente entre esta app y escaner.html
// =======================================================
function mergeStockRemoto(remote){
  if(!remote) return;
  if(!DB.componentes) DB.componentes=[];
  if(!DB.movimientos) DB.movimientos=[];
  if(!DB.config) DB.config={};
  var byId={}; DB.componentes.forEach(function(c){byId[c.id]=c;});
  (remote.componentes||[]).forEach(function(rc){
    var local=byId[rc.id];
    if(!local){ DB.componentes.push(rc); byId[rc.id]=rc; }
    else if((rc.lastModified||0) > (local.lastModified||0)){ Object.assign(local, rc); }
  });
  var movIds={}; DB.movimientos.forEach(function(m){movIds[m.id]=true;});
  (remote.movimientos||[]).forEach(function(rm){
    if(!movIds[rm.id]){ DB.movimientos.push(rm); movIds[rm.id]=true; }
  });
  ['motivosSalida','origenesEntrada'].forEach(function(k){
    var localArr=DB.config[k]||[];
    var remoteArr=(remote.config&&remote.config[k])||[];
    remoteArr.forEach(function(v){ if(localArr.indexOf(v)===-1) localArr.push(v); });
    DB.config[k]=localArr;
  });
}

function stockBackupPayload(){
  return {
    componentes: DB.componentes||[],
    movimientos: DB.movimientos||[],
    config: {
      motivosSalida: (DB.config&&DB.config.motivosSalida)||[],
      origenesEntrada: (DB.config&&DB.config.origenesEntrada)||[]
    },
    updatedAt: Date.now()
  };
}

var _stockPushTimer=null;
function scheduleStockPush(){
  if(!window._vssStockDriveOn) return; // recién empieza a empujar solo después de conectar una vez
  if(_stockPushTimer) clearTimeout(_stockPushTimer);
  _stockPushTimer=setTimeout(function(){
    vssDriveGetToken(function(token){
      vssDriveEnsureFolderNamed(token, 'RiegoAdaptativoStock', function(folderId){
        vssDriveSubirArchivo(token, folderId, 'riego-adaptativo-stock.json', stockBackupPayload(), function(){});
      });
    });
  }, 1500);
}

function syncStockDesdeDrive(mostrarAlert){
  vssDriveGetToken(function(token){
    window._vssStockDriveOn = true;
    vssDriveEnsureFolderNamed(token, 'RiegoAdaptativoStock', function(folderId){
      vssDriveBuscarArchivo(token, folderId, 'riego-adaptativo-stock.json', function(f){
        function subirYAvisar(esNuevo){
          vssDriveSubirArchivo(token, folderId, 'riego-adaptativo-stock.json', stockBackupPayload(), function(){
            if(mostrarAlert) alert(esNuevo?'Stock conectado a Drive. Ya se puede usar el escáner desde el celular.':'Stock sincronizado con Drive.');
          });
        }
        if(!f){ subirYAvisar(true); return; }
        vssDriveBajarJSON(token, f.id, function(remote){
          mergeStockRemoto(remote);
          localStorage.setItem(SKEY, JSON.stringify(DB));
          invalidarStockCache();
          renderStock();renderCatalogo();renderMovimientos();
          subirYAvisar(false);
        });
      });
    });
  });
}

// =======================================================
// NAV
// =======================================================
let curCid=null, curSub='datos';
const PANELS=['clientes','alta','detalle','versiones','tipos','backup','presupuestos','stock','catalogo','movimientos','ordenes','config','reportes','proveedores','gestion','fondos','fabricacion','kit','instalaciones','kitinst','actas','mantenimientos'];

// Mapa de panel -> ancla en instructivo.html (usado por el botón de ayuda contextual "?")
const ANCLAS_AYUDA={clientes:'clientes',alta:'clientes',detalle:'ficha',versiones:'versiones',tipos:'tipos',backup:'backup',presupuestos:'presupuestos',stock:'stock',catalogo:'stock',movimientos:'movimientos',ordenes:'ordenes',config:'config',reportes:'reportes',proveedores:'proveedores',gestion:'gestion',fondos:'fondos',fabricacion:'fabricacion',kit:'kit',instalaciones:'instalaciones',kitinst:'kitinst',actas:'actas',mantenimientos:'mantenimientos'};
var _panelActual='clientes';
function abrirAyudaPanel(){
  var ancla=ANCLAS_AYUDA[_panelActual]||'intro';
  window.open('instructivo.html#'+ancla,'_blank','width=1100,height=750,resizable=yes,scrollbars=yes');
}

function goTo(p){
  _panelActual=p;
  PANELS.forEach(x=>{
    const panel=document.getElementById('panel-'+x);
    if(panel) panel.classList.toggle('on',x===p);
    const n=document.getElementById('nav-'+x);
    if(n) n.classList.toggle('on',x===p);
  });
  const titles={clientes:'Clientes',alta:'Alta de cliente',detalle:'Ficha de cliente',versiones:'Versiones de software',tipos:'Tipos de sensor',backup:'Backup / Restaurar',presupuestos:'Presupuestos',stock:'Stock actual',catalogo:'Catálogo',movimientos:'Movimientos de stock',ordenes:'Órdenes de compra',fabricacion:'Órdenes de trabajo',kit:'Líneas de producto',instalaciones:'Pedidos de instalación',kitinst:'Kit base instalación',actas:'Actas de conformidad',mantenimientos:'Mantenimientos',fondos:'Movimiento de fondos',gestion:'Gestión económica',config:'Configuración',reportes:'Reportes',proveedores:'Proveedores'};
  document.getElementById('ptitle').textContent=titles[p]||p;
  document.getElementById('tctx').textContent='';
  const pa=document.getElementById('pacts'); pa.innerHTML='';
  if(p==='clientes'){
    pa.innerHTML='<button class="btn btn-p" onclick="goTo(\'alta\')">➕ Nuevo cliente</button>';
    renderStats(); renderClientes();
  }
  if(p==='alta' && !window._convData) limpiarAlta();
  if(p==='versiones') renderVersiones();
  if(p==='tipos') renderTipos();
  if(p==='backup') renderBackupInfo();
  if(p==='fabricacion') renderFabricacion();
  if(p==='kit') renderLineasProducto();
  if(p==='instalaciones') renderInstalaciones();
  if(p==='kitinst') renderKitInst();
  if(p==='actas') renderActas();
  if(p==='mantenimientos') renderMantenimientos();
  if(p==='presupuestos') renderPresupuestos();
  if(p==='stock') renderStock();
  if(p==='catalogo') renderCatalogo();
  if(p==='movimientos') renderMovimientos();
  if(p==='ordenes') renderOrdenes();
  if(p==='config') renderConfig();
  if(p==='reportes') renderReportes();
  if(p==='proveedores') renderProveedores();
  if(p==='gestion') renderGestion();
  if(p==='fondos') renderFondos();
}

// =======================================================
// SUBPANELS
// =======================================================
const SUBS=['datos','equipo','zigbee','ota','mant','acta'];
function goSub(s){
  SUBS.forEach(x=>{
    var sp=document.getElementById('sp-'+x); if(sp) sp.classList.toggle('on',x===s);
    var sni=document.getElementById('sni-'+x); if(sni) sni.classList.toggle('on',x===s);
  });
  curSub=s;
  if(s==='datos') renderDatos();
  if(s==='equipo') renderEquipo();
  if(s==='zigbee') renderZigbee();
  if(s==='ota') renderOTA();
  if(s==='mant') renderMant();
  if(s==='acta') renderActa();
}

// =======================================================
// HELPERS
// =======================================================
function gc(){ return DB.clientes.find(x=>x.id===curCid); }
function ini(n){ return n.split(/[,\s]+/).filter(Boolean).map(w=>w[0]).join('').slice(0,2).toUpperCase(); }
const AVC=['background:#E3F2FD;color:#0D47A1','background:#E8F5E9;color:#1B5E20','background:#FFF8E1;color:#7B4F00','background:#FCE4EC;color:#880E4F','background:#E8EAF6;color:#283593','background:#E0F2F1;color:#004D40'];
function avC(n){ let h=0; for(let c of n) h=(h+c.charCodeAt(0))%AVC.length; return AVC[h]; }
function mPill(m){ const mp={AquaOne:'p-x',AquaDuo:'p-a',AquaTrio:'p-b',AquaPro:'p-g',AquaMax:'p-r'}; return `<span class="pill ${mp[m]||'p-x'}">${m}</span>`; }
function ePill(e){ return `<span class="pill ${e==='Activo'?'p-g':(e==='Potencial'?'p-a':'p-r')}">${e}</span>`; }
function potencialLockMsg(){
  return '<div class="empty">🔒 Este cliente es <b>Potencial</b> todavía — esta sección se habilita cuando se aprueba un presupuesto y pasa a estado Activo.</div>';
}
function tPill(t){ const tp={Puerta:'p-b',Ventana:'p-x','Movimiento PIR':'p-a',Botón:'p-g',Humo:'p-r',Vibración:'p-p'}; return `<span class="pill ${tp[t]||'p-x'}">${t}</span>`; }
function metPill(m){ const mp={OTA:'p-b',Serial:'p-a',Manual:'p-x'}; return `<span class="pill ${mp[m]||'p-x'}">${m}</span>`; }
function resPill(r){ const rp={Exitoso:'p-g',Fallido:'p-r',Parcial:'p-a'}; return `<span class="pill ${rp[r]||'p-x'}">${r}</span>`; }
function verPill(t){ const vp={Mayor:'p-r',Menor:'p-a',Patch:'p-x'}; return `<span class="pill ${vp[t]||'p-x'}">${t}</span>`; }
function garPill(g){ return g==='Sí'?'<span class="pill p-g">Sí</span>':'<span class="pill p-x">No</span>'; }
function tipMantPill(t){ const tp={Correctivo:'p-r',Configuración:'p-b',Actualización:'p-g','Cambio de pilas':'p-p'}; return `<span class="pill ${tp[t]||'p-x'}">${t||'Correctivo'}</span>`; }
function fbox(l,v,mono=false){ return `<div class="fbox"><div class="fl">${l}</div><div class="fv${mono?' mono':''}">${v||'—'}</div></div>`; }
function today(){
  var d=new Date();
  var y=d.getFullYear();
  var m=String(d.getMonth()+1).padStart(2,'0');
  var day=String(d.getDate()).padStart(2,'0');
  return y+'-'+m+'-'+day;
}

// =======================================================
// STATS
// =======================================================
function renderStats(){
  const c=DB.clientes;
  const act=c.filter(x=>x.estado==='Activo').length;
  const pot=c.filter(x=>x.estado==='Potencial').length;
  const baj=c.filter(x=>x.estado==='Baja').length;
  const one=c.filter(x=>x.estado==='Activo'&&x.modelo==='AquaOne').length;
  const duo=c.filter(x=>x.estado==='Activo'&&x.modelo==='AquaDuo').length;
  const trio=c.filter(x=>x.estado==='Activo'&&x.modelo==='AquaTrio').length;
  const pro=c.filter(x=>x.estado==='Activo'&&x.modelo==='AquaPro').length;
  const max=c.filter(x=>x.estado==='Activo'&&x.modelo==='AquaMax').length;
  document.getElementById('stats-box').innerHTML=`
    <div class="stat"><div class="stat-n green">${act}</div><div class="stat-l">Activos</div></div>
    <div class="stat"><div class="stat-n amber">${pot}</div><div class="stat-l">Potenciales</div></div>
    <div class="stat"><div class="stat-n red">${baj}</div><div class="stat-l">Bajas</div></div>
    <div class="stat"><div class="stat-n">${one}</div><div class="stat-l">AquaOne</div></div>
    <div class="stat"><div class="stat-n amber">${duo}</div><div class="stat-l">AquaDuo</div></div>
    <div class="stat"><div class="stat-n blue">${trio}</div><div class="stat-l">AquaTrio</div></div>
    <div class="stat"><div class="stat-n green">${pro}</div><div class="stat-l">AquaPro</div></div>
    <div class="stat"><div class="stat-n red">${max}</div><div class="stat-l">AquaMax</div></div>`;
}

// =======================================================
// CLIENTES LIST
// =======================================================
function renderClientes(){
  const q=(document.getElementById('qc').value||'').toLowerCase();
  const fm=document.getElementById('fc-modelo').value;
  const fe=document.getElementById('fc-estado').value;
  const list=DB.clientes.filter(c=>{
    return(!q||(c.nombre+c.lote+(c.barrio||'')+c.tel).toLowerCase().includes(q))&&(!fm||c.modelo===fm)&&(!fe||c.estado===fe);
  });
  const tb=document.getElementById('tbody-c');
  if(!list.length){tb.innerHTML='<tr><td colspan="9" class="empty">Sin resultados</td></tr>';return;}
  tb.innerHTML=list.map(c=>`<tr>
    <td style="color:var(--text3);font-size:11px">${String(c.id).padStart(3,'0')}</td>
    <td><div style="display:flex;align-items:center;gap:7px"><div class="av" style="${avC(c.nombre)}">${ini(c.nombre)}</div>${c.nombre}</div></td>
    <td>${c.lote}</td>
    <td>${c.barrio||'—'}</td>
    <td>${c.tel}</td>
    <td>${mPill(c.modelo)}</td>
    <td style="font-family:monospace;font-size:11px">${c.version||'—'}</td>
    <td>${ePill(c.estado)}</td>
    <td style="display:flex;gap:4px;flex-wrap:wrap">
      <button class="btn btn-sm" onclick="verCliente(${c.id})">👁️ Ver</button>
      ${c.estado==='Activo'
        ?`<button class="btn btn-sm" style="color:var(--red)" onclick="darBaja(${c.id})">🚫 Baja</button><button class="btn btn-sm" style="color:var(--red);margin-left:3px" onclick="borrarCliente(${c.id})">🗑️</button>`
        :c.estado==='Potencial'
        ?`<button class="btn btn-sm" style="color:var(--red)" onclick="borrarCliente(${c.id})">🗑️ Descartar</button>`
        :`<button class="btn btn-sm" style="color:var(--green)" onclick="reactivar(${c.id})">✅ Activar</button>`}
    </td>
  </tr>`).join('');
}

function darBaja(id){
  if(!confirm('¿Confirmar baja del cliente?')) return;
  DB.clientes.find(x=>x.id===id).estado='Baja';
  save(); renderStats(); renderClientes();
}

function borrarCliente(id){
  const c=DB.clientes.find(function(x){return x.id===id;});
  if(!c) return;
  var nOT=(DB.fabricacion||[]).filter(function(f){return f.clienteId===id;}).length;
  var nPI=(DB.instalaciones||[]).filter(function(p){return p.clienteId===id;}).length;
  var nMant=(DB.mantenimientos||[]).filter(function(m){return m.clienteId===id;}).length;
  var nFondos=(DB.fondos||[]).filter(function(f){return f.vinculo==='cli:'+id;}).length;
  var nGest=(DB.gestiones||[]).filter(function(g){return g.clienteNombre===c.nombre;}).length;
  var presVinculados=(DB.presupuestos||[]).filter(function(p){return p.clienteId===id||p.clientePotencialId===id;});
  var huerfanos=[];
  if(nOT) huerfanos.push(nOT+' orden(es) de trabajo');
  if(nPI) huerfanos.push(nPI+' pedido(s) de instalación');
  if(nMant) huerfanos.push(nMant+' registro(s) de mantenimiento');
  if(nFondos) huerfanos.push(nFondos+' movimiento(s) de fondos');
  if(nGest) huerfanos.push(nGest+' gestión(es) económica(s)');
  if(presVinculados.length) huerfanos.push(presVinculados.length+' presupuesto(s) vinculado(s) — van a quedar sin cliente asignado, pero el presupuesto en sí no se borra');
  var msg='¿Eliminar permanentemente al cliente "'+c.nombre+'"? Esta acción no se puede deshacer.';
  if(huerfanos.length){
    msg+='\n\n⚠️ Este cliente tiene registros relacionados que NO se van a borrar ni actualizar — van a quedar sin vínculo al cliente real:\n• '+huerfanos.join('\n• ')+'\n\nSi preferís conservar el historial, usá "Dar de baja" en lugar de eliminar.';
  }
  if(!confirm(msg)) return;
  if(!confirm('Última confirmación. ¿Eliminar "'+c.nombre+'"?')) return;
  presVinculados.forEach(function(p){
    if(p.clienteId===id) p.clienteId=null;
    if(p.clientePotencialId===id) p.clientePotencialId=null;
  });
  DB.clientes=DB.clientes.filter(function(x){return x.id!==id;});
  save(); renderStats(); renderClientes(); goTo('clientes');
}
function reactivar(id){
  DB.clientes.find(x=>x.id===id).estado='Activo';
  save(); renderStats(); renderClientes();
}

// =======================================================
// ALTA
// =======================================================
function limpiarAlta(){
  ['an','al','aba','at','av','amac','apin','achat','aemail','aambientes'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  const af=document.getElementById('af'); if(af) af.value=today();
  window._promoveClienteId = null;
}
function guardarCliente(){
  const n=document.getElementById('an').value.trim();
  const l=document.getElementById('al').value.trim();
  const t=document.getElementById('at').value.trim();
  if(!n||!t){alert('Nombre y teléfono son obligatorios.');return;}
  // Check for duplicate client (excepto si es el propio cliente potencial que estamos promoviendo)
  var promoveIdCheck = window._promoveClienteId||null;
  var duplicado = DB.clientes.find(function(c){
    if(promoveIdCheck && c.id===promoveIdCheck) return false;
    return c.nombre.toLowerCase()===n.toLowerCase() ||
           (t && c.tel && c.tel.replace(/\s/g,'')===t.replace(/\s/g,''));
  });
  if(duplicado){
    if(!confirm('\u26a0\ufe0f Ya existe un cliente con ese nombre o tel\u00e9fono: "'+duplicado.nombre+'" ('+duplicado.lote+').\n\n\u00bfContinuar de todas formas?')) return;
  }
  // Import sensors from relevamiento if converting from presupuesto
  var sensoresImport = window._convSensores||[];
  var presIdLink = window._convPresId||null;
  var dirLink = window._convDir||'';
  
  // Build zigbee array from sensores {tipo: {qty, ubicaciones:[]}}
  var zigbeeFromRel = [];
  if(sensoresImport && typeof sensoresImport === 'object' && !Array.isArray(sensoresImport)){
    Object.entries(sensoresImport).forEach(function(entry){
      var tipo = entry[0];
      var data = entry[1];
      if(!data || !data.qty || data.qty <= 0) return;
      var ubicaciones = data.ubicaciones || [];
      for(var i=0; i<data.qty; i++){
        zigbeeFromRel.push({
          tipo: tipo,
          nombre: ubicaciones[i] || tipo + ' ' + (i+1),
          marca: '',
          modelo: '',
          ubicacion: ubicaciones[i] || '',
          dir: '',
          pilas_marca: '',
          pilas_modelo: '',
          pilas_fecha: ''
        });
      }
    });
  }

  var nuevoCliente = {
    id:DB.nid++,nombre:n,lote:l,barrio:document.getElementById('aba').value,tel:t,
    modelo:document.getElementById('am').value,
    version:document.getElementById('av').value,
    fecha:document.getElementById('af').value,
    mac:document.getElementById('amac').value,
    pin:document.getElementById('apin').value,
    chatid:document.getElementById('achat').value,
    email:document.getElementById('aemail')?document.getElementById('aemail').value:'',
    ambientes:document.getElementById('aambientes')?document.getElementById('aambientes').value:'',
    dir:dirLink,
    estado:'Activo',
    estadoInstalacion:'Programado',
    presId:presIdLink,
    equipo:{esp_serie:'',proveedor:'',fcompra:'',bat_marca:'',bat_modelo:'',carg_marca:'',carg_modelo:'',fuente_marca:'',fuente_modelo:'',fuente_tension:'',sirena_marca:'',sirena_modelo:'',sirena_serie:'',sirena_corte:'No',garantia:'No',gar_vence:'',ultimo_service:''},
    zigbee:zigbeeFromRel,ota:[],mant:[]
  };

  // Si venimos de un cliente potencial, promovemos ESE registro (mismo id, mismo historial)
  // en vez de crear uno nuevo.
  var promoveId = window._promoveClienteId||null;
  var potencial = promoveId ? DB.clientes.find(function(c){return c.id===promoveId;}) : null;
  if(potencial){
    potencial.nombre=nuevoCliente.nombre; potencial.lote=nuevoCliente.lote; potencial.barrio=nuevoCliente.barrio;
    potencial.tel=nuevoCliente.tel; potencial.modelo=nuevoCliente.modelo; potencial.version=nuevoCliente.version;
    potencial.fecha=nuevoCliente.fecha; potencial.mac=nuevoCliente.mac; potencial.pin=nuevoCliente.pin;
    potencial.chatid=nuevoCliente.chatid; potencial.email=nuevoCliente.email; potencial.ambientes=nuevoCliente.ambientes;
    potencial.dir=nuevoCliente.dir||potencial.dir; potencial.estado='Activo'; potencial.estadoInstalacion='Programado';
    potencial.presId=presIdLink;
    if(zigbeeFromRel.length) potencial.zigbee=zigbeeFromRel;
  } else {
    DB.clientes.unshift(nuevoCliente);
  }
  var clienteFinalId = potencial ? potencial.id : nuevoCliente.id;

  // Link presupuesto to cliente
  if(presIdLink){
    var pres = DB.presupuestos.find(function(p){return p.id===presIdLink;});
    if(pres){ pres.estado='Aprobado'; pres.clienteId=clienteFinalId; }
  }

  window._convSensores = null;
  window._convPresId = null;
  window._convDir = null;
  window._promoveClienteId = null;

  save();

  // OT se crea manualmente desde Movimiento de fondos al registrar el anticipo
  limpiarAlta(); goTo('clientes');
}

// =======================================================
// VER CLIENTE
// =======================================================
function verCliente(id){
  curCid=id;
  goTo('detalle');
  const c=gc();
  document.getElementById('tctx').textContent=c.nombre+' · '+c.lote;
  document.getElementById('pacts').innerHTML=`
    <button class="btn btn-sm" onclick="goTo('clientes')">← Volver</button>
    ${c.estado==='Activo'
      ?`<button class="btn btn-sm btn-d" onclick="darBaja(${c.id});verCliente(${c.id})">🚫 Dar de baja</button><button class="btn btn-sm" style="background:#7F0000;color:#fff;margin-left:6px" onclick="borrarCliente(${c.id})">🗑️ Eliminar cliente</button>`
      :c.estado==='Potencial'
      ?`<button class="btn btn-sm" style="background:#7F0000;color:#fff" onclick="borrarCliente(${c.id})">🗑️ Descartar potencial</button>`
      :`<button class="btn btn-sm btn-g" onclick="reactivar(${c.id});verCliente(${c.id})">✅ Reactivar</button>`}`;
  document.getElementById('det-head').innerHTML=`
    <div style="display:flex;align-items:center;gap:10px;padding:10px 0">
      <div class="av" style="${avC(c.nombre)};width:40px;height:40px;font-size:14px">${ini(c.nombre)}</div>
      <div>
        <div style="font-size:15px;font-weight:700">${c.nombre}</div>
        <div style="font-size:11px;color:var(--text2)">${c.lote}${c.barrio?' · '+c.barrio:''} &nbsp;${mPill(c.modelo)} ${ePill(c.estado)}</div>
      </div>
    </div>`;
  SUBS.forEach(x=>{
    var sp=document.getElementById('sp-'+x);
    var sni=document.getElementById('sni-'+x);
    if(sp) sp.classList.toggle('on',x==='datos');
    if(sni) sni.classList.toggle('on',x==='datos');
  });
  renderDatos();
}

// =======================================================
// SUB: DATOS
// =======================================================

function setEstadoInstalacion(id, estado){
  var c = DB.clientes.find(function(x){return x.id===id;});
  if(!c) return;
  c.estadoInstalacion = estado;
  save(); renderDatos();
}

function saveNotasCliente(id, texto){
  var c = DB.clientes.find(function(x){return x.id===id;});
  if(!c) return;
  c.notas = texto;
  save();
}

function renderDatos(){
  const c=gc();
  document.getElementById('cont-datos').innerHTML=`
    <div class="fgrid">${fbox('Nombre',c.nombre)}${fbox('Lote',c.lote)}${fbox('Barrio',c.barrio)}</div>
    <div class="fgrid">${fbox('Teléfono',c.tel)}${fbox('Email',c.email||'—')}${fbox('Ambientes',c.ambientes?c.ambientes+' amb':'—')}</div>\n    <div class=\"fgrid\">${fbox('Estado',ePill(c.estado))}<div></div><div></div></div>
    <hr class="div">
    <div class="fgrid">${fbox('Modelo AquaSeries',mPill(c.modelo))}${fbox('Versión instalada',c.version,true)}${fbox('Fecha instalación',c.fecha)}</div>
    <hr class="div">
    <div class="fgrid">${fbox('MAC del ESP32',c.mac,true)}${fbox('PIN OTA',c.pin?'••••••':'')}${fbox('Chat ID Telegram',c.chatid,true)}</div>
    <hr class="div">
    <div class="sectitle">Instalación y notas</div>
    <div style="margin-top:8px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap">
        <span style="font-size:11px;color:var(--text2)">Estado:</span>
        ${['Programado','En fabricación','Terminado','Pendiente','En curso','Completada'].map(s=>
          '<button onclick="setEstadoInstalacion('+c.id+',\''+s+'\')" style="padding:3px 10px;border-radius:12px;font-size:11px;border:1px solid var(--border);cursor:pointer;background:'+(c.estadoInstalacion===s?'var(--brand)':'var(--surface2)')+';color:'+(c.estadoInstalacion===s?'#fff':'var(--text)')+'">'+s+'</button>'
        ).join('')}
      </div>
      <label style="font-size:11px;color:var(--text2);display:block;margin-bottom:4px">Notas internas</label>
      <textarea onblur="saveNotasCliente(${c.id},this.value)" style="width:100%;min-height:70px;padding:7px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;font-family:inherit;background:var(--surface2);color:var(--text);resize:vertical">${c.notas||''}</textarea>
    </div>`;
}

function editarDatos(){
  const c=gc();
  openModal('Editar datos del cliente',`
    <div class="fg3">
      <div class="fg"><label>Nombre *</label><input id="ed-n" value="${c.nombre}"></div>
      <div class="fg"><label>Lote *</label><input id="ed-l" value="${c.lote}"></div>
      <div class="fg"><label>Barrio</label><input id="ed-ba" value="${c.barrio||''}"></div>
      <div class="fg"><label>Teléfono *</label><input id="ed-t" value="${c.tel}"></div>
      <div class="fg"><label>Modelo AquaSeries</label><select id="ed-m">${['AquaOne','AquaDuo','AquaTrio','AquaPro','AquaMax'].map(m=>`<option${c.modelo===m?' selected':''}>${m}</option>`).join('')}</select></div>
      <div class="fg"><label>Versión instalada</label><input id="ed-v" value="${c.version||''}"></div>
      <div class="fg"><label>Fecha instalación</label><input id="ed-f" type="date" value="${c.fecha||''}"></div>
      <div class="fg"><label>MAC del ESP32</label><input id="ed-mac" value="${c.mac||''}" style="font-family:monospace"></div>
      <div class="fg"><label>PIN OTA</label><input id="ed-pin" type="password" value="${c.pin||''}"></div>
      <div class="fg"><label>Chat ID Telegram</label><input id="ed-chat" value="${c.chatid||''}" style="font-family:monospace"></div>
    </div>`,()=>{
    const n=document.getElementById('ed-n').value.trim();
    const l=document.getElementById('ed-l').value.trim();
    const t=document.getElementById('ed-t').value.trim();
    if(!n||!l||!t){alert('Nombre, lote y teléfono son obligatorios.');return false;}
    c.nombre=n;c.lote=l;c.barrio=document.getElementById('ed-ba').value;c.tel=t;
    c.modelo=document.getElementById('ed-m').value;
    c.version=document.getElementById('ed-v').value;
    c.fecha=document.getElementById('ed-f').value;
    c.mac=document.getElementById('ed-mac').value;
    c.pin=document.getElementById('ed-pin').value;
    c.chatid=document.getElementById('ed-chat').value;
    if(document.getElementById('ed-email')) c.email=document.getElementById('ed-email').value;
    if(document.getElementById('ed-amb')) c.ambientes=document.getElementById('ed-amb').value;
    save();renderDatos();verCliente(c.id);return true;
  });
}

// =======================================================
// SUB: EQUIPAMIENTO
// =======================================================
function renderEquipo(){
  const c=gc();
  if(c.estado==='Potencial'){document.getElementById('cont-equipo').innerHTML=potencialLockMsg();return;}
  const e=c.equipo;
  document.getElementById('cont-equipo').innerHTML=`
    <div class="sectitle">Procesador / Central</div>
    <div class="fgrid">${fbox('N° serie',e.esp_serie,true)}${fbox('Proveedor',e.proveedor)}${fbox('Fecha de compra',e.fcompra)}</div>
    <hr class="div">
    <div class="twocol">
      <div>
        <div class="sectitle">Actuador de válvula</div>
        <div class="fgrid2">
          ${fbox('Marca',e.ups_marca||'—')}${fbox('Modelo',e.ups_modelo||'—')}
          ${fbox('Tensión de salida',e.ups_tension||'—')}${fbox('Garantía',garPill(e.ups_garantia))}
          ${fbox('Venc. garantía',e.ups_gar_vence||'—')}${fbox('Último service',e.ups_ultimo_service||'—')}
        </div>
      </div>
      <div>
        <div class="sectitle">Sensor de humedad (Mi Flora)</div>
        <div class="fgrid2">
          ${fbox('Marca',e.sirena_marca)}${fbox('Modelo',e.sirena_modelo)}
          ${fbox('N° de serie',e.sirena_serie,true)}
        </div>
      </div>
    </div>`;
}


function stockOpts(categoria){
  // Get components from stock filtered by category keywords
  var items = DB.componentes.filter(function(c){
    if(!categoria) return true;
    return c.categoria && c.categoria.toLowerCase().indexOf(categoria.toLowerCase()) >= 0;
  });
  if(!items.length) return DB.componentes; // fallback all
  return items;
}

function stockDatalist(id, categoria, mode){
  if(mode==='ubicaciones'){
    var ubics=[...new Set(DB.componentes.map(function(c){return c.ubicacion;}).filter(Boolean))];
    return '<datalist id="dl-'+id+'">'+ubics.map(function(u){return '<option value="'+u+'"></option>';}).join('')+'</datalist>';
  }
  var opts = DB.componentes;
  if(categoria){
    var filtered = opts.filter(function(c){
      return c.categoria && c.categoria.toLowerCase().indexOf(categoria.toLowerCase()) >= 0;
    });
    if(filtered.length) opts = filtered;
  }
  return '<datalist id="dl-'+id+'">'+opts.map(function(c){
    return '<option value="'+c.desc+'">'+c.codigo+'</option>';
  }).join('')+'</datalist>';
}

function editarEquipo(){
  const c=gc();const e=c.equipo;
  openModal('Editar equipamiento',`
    <div class="fg3">
      <div class="fsec" style="border-top:none;padding-top:0;margin-top:0">Procesador / Central</div>
      <div class="fg"><label>N° serie</label><input id="eq-es" value="${e.esp_serie||''}"></div>
      <div class="fg"><label>Proveedor</label><input id="eq-pr" value="${e.proveedor||''}"></div>
      <div class="fg"><label>Fecha compra</label><input id="eq-fc" type="date" value="${e.fcompra||''}"></div>
      <div class="fsec">Actuador de válvula</div>
      <div class="fg"><label>Marca</label><input id="eq-ups-m" value="${e.ups_marca||''}"></div>
      <div class="fg"><label>Modelo</label><input id="eq-ups-mo" value="${e.ups_modelo||''}"></div>
      <div class="fg"><label>Tensión de salida</label><input id="eq-ups-t" value="${e.ups_tension||''}" placeholder="Ej: 12V DC"></div>
      <div class="fg"><label>Garantía</label><select id="eq-ups-g"><option${(e.ups_garantia||'No')==='Sí'?' selected':''}>Sí</option><option${(e.ups_garantia||'No')!=='Sí'?' selected':''}>No</option></select></div>
      <div class="fg"><label>Vencimiento garantía</label><input id="eq-ups-gv" type="date" value="${e.ups_gar_vence||''}"></div>
      <div class="fg"><label>Último service</label><input id="eq-ups-us" type="date" value="${e.ups_ultimo_service||''}"></div>
      <div class="fsec">Sensor de humedad (Mi Flora)</div>
      <div class="fg"><label>Marca</label><input id="eq-sm" value="${e.sirena_marca||''}"></div>
      <div class="fg"><label>Modelo</label><input id="eq-smo" value="${e.sirena_modelo||''}"></div>
      <div class="fg"><label>N° serie</label><input id="eq-ss" value="${e.sirena_serie||''}"></div>
    </div>`,()=>{
    e.esp_serie=document.getElementById('eq-es').value;
    e.proveedor=document.getElementById('eq-pr').value;
    e.fcompra=document.getElementById('eq-fc').value;
    e.ups_marca=document.getElementById('eq-ups-m').value;
    e.ups_modelo=document.getElementById('eq-ups-mo').value;
    e.ups_tension=document.getElementById('eq-ups-t').value;
    e.ups_garantia=document.getElementById('eq-ups-g').value;
    e.ups_gar_vence=document.getElementById('eq-ups-gv').value;
    e.ups_ultimo_service=document.getElementById('eq-ups-us').value;
    e.sirena_marca=document.getElementById('eq-sm').value;
    e.sirena_modelo=document.getElementById('eq-smo').value;
    e.sirena_serie=document.getElementById('eq-ss').value;
    save();renderEquipo();return true;
  });
}

// =======================================================
// SUB: ZIGBEE
// =======================================================
function renderZigbee(){
  const c=gc();
  if(c.estado==='Potencial'){document.getElementById('cont-zigbee').innerHTML=potencialLockMsg();return;}
  if(!c.zigbee.length){document.getElementById('cont-zigbee').innerHTML='<div class="empty">📡 Sin sensores registrados. Usá "Agregar sensor" para registrar el primero.</div>';return;}
  document.getElementById('cont-zigbee').innerHTML=`<table>
    <colgroup><col style="width:8%"><col style="width:11%"><col style="width:9%"><col style="width:9%"><col style="width:12%"><col style="width:11%"><col style="width:10%"><col style="width:10%"><col style="width:11%"><col style="width:9%"></colgroup>
    <thead><tr><th>Tipo</th><th>Nombre</th><th>Marca</th><th>Modelo</th><th>ID / dirección</th><th>Ubicación</th><th>Marca pilas</th><th>Modelo pilas</th><th>Cambio pilas</th><th></th></tr></thead>
    <tbody>${c.zigbee.map((d,i)=>`<tr>
      <td>${tPill(d.tipo)}</td><td>${d.nombre}</td><td>${d.marca||'—'}</td><td>${d.modelo||'—'}</td>
      <td class="mono">${d.hex||'—'}</td><td>${d.ubicacion||'—'}</td>
      <td>${d.marcaPilas||'—'}</td><td>${d.modeloPilas||'—'}</td><td>${d.fechaCambioPilas||'—'}</td>
      <td style="display:flex;gap:3px">
        <button class="btn btn-sm" title="Editar" onclick="modalZigbee(${i})">✏️</button>
        <button class="btn btn-sm" style="color:var(--red)" title="Eliminar" onclick="elimZigbee(${i})">🗑️</button>
      </td>
    </tr>`).join('')}</tbody></table>`;
}

function modalZigbee(idx=-1){
  const c=gc();
  const d=idx>=0?c.zigbee[idx]:{};
  const tipos=[...DB.tipos].sort((a,b)=>(a||'').localeCompare(b||'')).map(t=>`<option${(d.tipo||'')==t?' selected':''}>${t}</option>`).join('');
  openModal(idx>=0?'Editar sensor de riego':'Agregar sensor de riego',`
    <div class="fg3">
      <div class="fg"><label>Tipo *</label><select id="z-t">${tipos}</select></div>
      <div class="fg"><label>Nombre *</label><input id="z-n" value="${d.nombre||''}" placeholder="Ej: Entrada principal"></div>
      <div class="fg"><label>Marca</label><input id="z-ma" value="${d.marca||''}" placeholder="Aqara, Sonoff, Tuya..."></div>
      <div class="fg"><label>Modelo</label><input id="z-mo" value="${d.modelo||''}" placeholder="MCCGQ11LM" list="dl-z-mo">${stockDatalist("z-mo","")}</div>
      <div class="fg"><label>ID / dirección del dispositivo</label><input id="z-h" value="${d.hex||''}" placeholder="Ej: MAC o ID interno" style="font-family:monospace"></div>
      <div class="fg"><label>Ubicación física</label><input id="z-u" value="${d.ubicacion||''}" placeholder="Ej: Frente, puerta madera"></div>
      <div class="fg"><label>Marca de pilas</label><input id="z-mp" value="${d.marcaPilas||''}" placeholder="Ej: Energizer"></div>
      <div class="fg"><label>Modelo de pilas</label><input id="z-mop" value="${d.modeloPilas||''}" placeholder="Ej: AA 1.5V"></div>
      <div class="fg"><label>Fecha último cambio pilas</label><input id="z-fcp" type="date" value="${d.fechaCambioPilas||''}"></div>
      <div class="fg full"><label>Observaciones</label><input id="z-o" value="${d.obs||''}" placeholder="Opcional"></div>
    </div>`,()=>{
    const n=document.getElementById('z-n').value.trim();
    if(!n){alert('El nombre es obligatorio.');return false;}
    const mp=document.getElementById('z-mp')?document.getElementById('z-mp').value:'';
    const mop=document.getElementById('z-mop')?document.getElementById('z-mop').value:'';
    const fcp=document.getElementById('z-fcp')?document.getElementById('z-fcp').value:'';
    const obj={tipo:document.getElementById('z-t').value,nombre:n,marca:document.getElementById('z-ma').value,modelo:document.getElementById('z-mo').value,hex:document.getElementById('z-h').value,marcaPilas:mp,modeloPilas:mop,fechaCambioPilas:fcp,ubicacion:document.getElementById('z-u').value,obs:document.getElementById('z-o').value};
    if(idx>=0) c.zigbee[idx]=obj; else c.zigbee.push(obj);
    save();renderZigbee();return true;
  });
}
function elimZigbee(i){if(!confirm('¿Eliminar este sensor?'))return;gc().zigbee.splice(i,1);save();renderZigbee();}

// =======================================================
// SUB: OTA
// =======================================================
function renderOTA(){
  const c=gc();
  const tot=c.ota.length,ex=c.ota.filter(x=>x.resultado==='Exitoso').length,fa=c.ota.filter(x=>x.resultado==='Fallido').length;
  document.getElementById('ota-stats').innerHTML=`<div class="stats stats-3">
    <div class="stat"><div class="stat-n">${tot}</div><div class="stat-l">Total actualizaciones</div></div>
    <div class="stat"><div class="stat-n green">${ex}</div><div class="stat-l">Exitosas</div></div>
    <div class="stat"><div class="stat-n red">${fa}</div><div class="stat-l">Fallidas</div></div>
  </div>`;
  if(!c.ota.length){document.getElementById('cont-ota').innerHTML='<div class="empty">🔄 Sin actualizaciones registradas</div>';return;}
  document.getElementById('cont-ota').innerHTML=`<table>
    <colgroup><col style="width:10%"><col style="width:12%"><col style="width:12%"><col style="width:9%"><col style="width:10%"><col style="width:37%"><col style="width:10%"></colgroup>
    <thead><tr><th>Fecha</th><th>Versión anterior</th><th>Versión nueva</th><th>Método</th><th>Resultado</th><th>Observaciones</th><th></th></tr></thead>
    <tbody>${c.ota.map((o,i)=>`<tr>
      <td>${o.fecha}</td><td class="mono">${o.vant}</td><td class="mono">${o.vnueva}</td>
      <td>${metPill(o.metodo)}</td><td>${resPill(o.resultado)}</td><td>${o.obs||'—'}</td>
      <td><button class="btn btn-sm" onclick="modalOTA(${i})" title="Editar">✏️</button></td>
    </tr>`).join('')}</tbody></table>`;
}

function modalOTA(idx){
  const c=gc();
  const o=idx>=0?c.ota[idx]:{};
  const vers=[...versiones].sort((a,b)=>(a.ver||'').localeCompare(b.ver||'')).map(v=>`<option${(o.vnueva||'')==v.ver?' selected':''}>${v.ver}</option>`).join('');
  openModal(idx>=0?'Editar actualización OTA':'Registrar actualización OTA',`
    <div class="fg2">
      <div class="fg"><label>Fecha *</label><input id="ot-f" type="date" value="${o.fecha||today()}"></div>
      <div class="fg"><label>Método *</label><select id="ot-m">${['OTA','Serial','Manual'].map(m=>`<option${(o.metodo||'')==m?' selected':''}>${m}</option>`).join('')}</select></div>
      <div class="fg"><label>Versión anterior *</label><input id="ot-va" value="${o.vant||''}" placeholder="v2.3.0" style="font-family:monospace"></div>
      <div class="fg"><label>Versión nueva *</label><select id="ot-vn"><option value="">— seleccionar —</option>${vers}</select></div>
      <div class="fg"><label>Resultado *</label><select id="ot-r">${['Exitoso','Fallido','Parcial'].map(r=>`<option${(o.resultado||'')==r?' selected':''}>${r}</option>`).join('')}</select></div>
      <div class="fg full"><label>Observaciones</label><textarea id="ot-o">${o.obs||''}</textarea></div>
    </div>`,()=>{
    const va=document.getElementById('ot-va').value.trim();
    const vn=document.getElementById('ot-vn').value;
    if(!va||!vn){alert('Versión anterior y nueva son obligatorias.');return false;}
    const obj={fecha:document.getElementById('ot-f').value,vant:va,vnueva:vn,metodo:document.getElementById('ot-m').value,resultado:document.getElementById('ot-r').value,obs:document.getElementById('ot-o').value};
    if(idx>=0) c.ota[idx]=obj; else c.ota.unshift(obj);
    if(idx<0) c.version=vn;
    save();renderOTA();if(idx<0)renderDatos();return true;
  });
}

// =======================================================
// SUB: MANTENIMIENTO
// =======================================================
function renderMant(){
  const c=gc();
  if(c.estado==='Potencial'){document.getElementById('mant-stats').innerHTML='';document.getElementById('cont-mant').innerHTML=potencialLockMsg();return;}
  const tot=c.mant.length,gar=c.mant.filter(x=>x.garantia==='Sí').length,costo=c.mant.reduce((a,x)=>a+(parseFloat(x.costo)||0),0);
  document.getElementById('mant-stats').innerHTML=`<div class="stats stats-3">
    <div class="stat"><div class="stat-n">${tot}</div><div class="stat-l">Visitas totales</div></div>
    <div class="stat"><div class="stat-n green">${gar}</div><div class="stat-l">En garantía</div></div>
    <div class="stat"><div class="stat-n blue">$${Math.round(costo).toLocaleString('es-AR').toLocaleString('es-AR')}</div><div class="stat-l">Costo acumulado</div></div>
  </div>`;
  if(!c.mant.length){document.getElementById('cont-mant').innerHTML='<div class="empty">🛠️ Sin visitas registradas</div>';return;}
  document.getElementById('cont-mant').innerHTML=`<table>
    <colgroup><col style="width:9%"><col style="width:10%"><col style="width:13%"><col style="width:12%"><col style="width:12%"><col style="width:7%"><col style="width:7%"><col style="width:10%"><col style="width:14%"><col style="width:6%"></colgroup>
    <thead><tr><th>N°</th><th>Fecha</th><th>Tipo</th><th>Motivo llamado</th><th>Falla detectada</th><th>Reparación</th><th>Garantía</th><th>Técnico</th><th></th></tr></thead>
    <tbody>${c.mant.map((m,i)=>`<tr>
      <td style="font-family:monospace;font-size:10px">${m.numero||'—'}</td>
      <td>${m.fecha}</td>
      <td>${tipMantPill(m.tipo)}</td>
      <td>${m.motivo}</td><td>${m.falla||'—'}</td><td>${m.reparacion||'—'}</td>
      <td>${garPill(m.garantia)}</td>
      <td>${garPill(m.garantia)}</td>
      <td>${m.tecnico||'—'}</td>
      <td style="display:flex;gap:3px"><button class="btn btn-sm btn-p" onclick="exportarMant(${c.id},${i})" title="Exportar al móvil">📤</button><button class="btn btn-sm" onclick="modalMant(${i})" title="Editar">✏️</button></td>
    </tr>`).join('')}</tbody></table>`;
}


function getMantDatalist(campo, dlId){
  var vals = [];
  DB.clientes.forEach(function(c){
    if(!c.mant) return;
    c.mant.forEach(function(m){
      if(m[campo]&&m[campo].trim()) vals.push(m[campo].trim());
    });
  });
  vals = [...new Set(vals)].sort();
  return '<datalist id="'+dlId+'">'+vals.map(function(v){return '<option value="'+v.replace(/"/g,"'")+'">';}).join('')+'</datalist>';
}

function modalMant(idx){
  const c=gc();
  const m=idx>=0?c.mant[idx]:{};
  const nserie=c.zigbee&&c.zigbee.length?c.mac||'—':c.mac||'—';
  const numMant=m.numero||getNumMant();
  const tipoOpts=['Correctivo','Preventivo','Configuración','Actualización de firmware','Cambio de pilas','Garantía','Otro'];
  openModal(idx>=0?'Editar registro — '+m.numero:'Nuevo registro de mantenimiento',`
    <div class="fg2">
      <div class="fg"><label>N° Registro</label><div style="padding:6px 9px;font-family:monospace;font-weight:700;color:var(--brand)">${numMant}</div></div>
      <div class="fg"><label>Fecha *</label><input id="mt-f" type="date" value="${m.fecha||today()}"></div>
      <div class="fg"><label>Técnico</label><input id="mt-te" value="${m.tecnico||''}" placeholder="Nombre del técnico"></div>
      <div class="fg"><label>Tipo *</label><select id="mt-ti">${tipoOpts.map(t=>`<option${(m.tipo||'')==t?' selected':''}>${t}</option>`).join('')}</select></div>
      <div class="fg"><label>N° Serie sistema</label><input id="mt-ns" value="${m.nserie||c.mac||''}" placeholder="AQ-2026-001"></div>
      <div class="fg"><label>Garantía válida hasta</label><input id="mt-gv" type="date" value="${m.garantiaVence||c.actaGarantiaVence||''}"></div>
      <div class="fg full"><label>Motivo del llamado *</label><input id="mt-mo" value="${m.motivo||''}" placeholder="Ej: Válvula no cierra, sensor sin señal..." list="dl-mt-mo">${getMantDatalist('motivo','dl-mt-mo')}</div>
      <div class="fg full"><label>Falla detectada</label><input id="mt-fa" value="${m.falla||''}" placeholder="Ej: Conexión suelta, sensor desincronizado" list="dl-mt-fa">${getMantDatalist('falla','dl-mt-fa')}</div>
      <div class="fg full"><label>Reparación realizada</label><input id="mt-re" value="${m.reparacion||''}" placeholder="Ej: Reconexión terminal, recalibración de sensor" list="dl-mt-re">${getMantDatalist('reparacion','dl-mt-re')}</div>
      <div class="fg full"><label>Material utilizado (del stock)</label><div id="mt-mat-list" style="margin-bottom:6px">${(m.materiales||[]).map((mat,i)=>'<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px"><span style="font-size:11px;flex:1">'+mat.desc+' x'+mat.cant+'</span><button type="button" onclick="quitarMatMant('+i+')" style="background:none;border:none;color:var(--red);cursor:pointer">🗑️</button></div>').join('')}</div><button type="button" class="btn btn-sm" onclick="agregarMatMant()">➕ Agregar material</button></div>
      <div class="fg full"><label>Material a facturar</label><input id="mt-mf" value="${m.matFacturar||''}" placeholder="Describir material a facturar al cliente"></div>
      <div class="fg"><label>En garantía</label><select id="mt-g"><option${(m.garantia||'No')==='No'?' selected':''}>No</option><option${(m.garantia||'')==='Sí'?' selected':''}>Sí</option></select></div>
      <div class="fg"><label>Costo mano de obra ($)</label><input id="mt-c" type="number" min="0" value="${m.costo||0}"></div>
      <div class="fg full"><label>Observaciones</label><textarea id="mt-o" rows="2">${m.obs||''}</textarea></div>
    </div>`,()=>{
    const mo=document.getElementById('mt-mo').value.trim();
    if(!mo){alert('El motivo del llamado es obligatorio.');return false;}
    const obj={
      numero:numMant,
      fecha:document.getElementById('mt-f').value,
      tecnico:document.getElementById('mt-te').value,
      tipo:document.getElementById('mt-ti').value,
      nserie:document.getElementById('mt-ns').value,
      garantiaVence:document.getElementById('mt-gv').value,
      motivo:mo,
      falla:document.getElementById('mt-fa').value,
      reparacion:document.getElementById('mt-re').value,
      materiales:window._mantMateriales||m.materiales||[],
      matFacturar:document.getElementById('mt-mf').value,
      garantia:document.getElementById('mt-g').value,
      costo:document.getElementById('mt-c').value||'0',
      obs:document.getElementById('mt-o').value,
      estado:'Completado'
    };
    window._mantMateriales=null;
    if(idx>=0) c.mant[idx]=obj; else c.mant.unshift(obj);
    save();renderMant();return true;
  });
  window._mantMateriales=m.materiales?JSON.parse(JSON.stringify(m.materiales)):[];
}

function agregarMatMant(){
  var compSel=[...DB.componentes].sort(function(a,b){return (a.desc||'').localeCompare(b.desc||'');}).map(function(c){
    return '<option value="'+c.id+'">'+c.codigo+' — '+c.desc+'</option>';
  }).join('');
  var cant=prompt('Cantidad:','1');
  if(!cant) return;
  var sel=document.createElement('select');
  sel.innerHTML='<option value="">-- seleccionar --</option>'+compSel;
  // Use a simple approach - ask for component by showing a mini modal
  openModal('Agregar material',
    '<div class="fg2">'+
      '<div class="fg full"><label>Componente</label>'+
        '<select id="am-comp" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
          '<option value="">-- seleccionar --</option>'+compSel+
        '</select></div>'+
      '<div class="fg"><label>Cantidad</label><input id="am-cant" type="number" min="1" value="1"></div>'+
    '</div>',
    function(){
      var compId=parseInt(document.getElementById('am-comp').value)||0;
      var cant=parseFloat(document.getElementById('am-cant').value)||0;
      if(!compId||!cant){alert('Seleccioná un componente.');return false;}
      var comp=DB.componentes.find(function(c){return c.id===compId;})||{};
      if(!window._mantMateriales) window._mantMateriales=[];
      window._mantMateriales.push({compId:compId,desc:comp.desc||'',codigo:comp.codigo||'',cant:cant,costo:comp.costo||0});
      // Refresh the list
      var list=document.getElementById('mt-mat-list');
      if(list) list.innerHTML=window._mantMateriales.map(function(mat,i){
        return '<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px"><span style="font-size:11px;flex:1">'+mat.desc+' x'+mat.cant+'</span><button type="button" onclick="quitarMatMant('+i+')" style="background:none;border:none;color:var(--red);cursor:pointer">🗑️</button></div>';
      }).join('');
      return true;
    }
  );
}

function quitarMatMant(idx){
  if(!window._mantMateriales) return;
  window._mantMateriales.splice(idx,1);
  var list=document.getElementById('mt-mat-list');
  if(list) list.innerHTML=window._mantMateriales.map(function(mat,i){
    return '<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px"><span style="font-size:11px;flex:1">'+mat.desc+' x'+mat.cant+'</span><button type="button" onclick="quitarMatMant('+i+')" style="background:none;border:none;color:var(--red);cursor:pointer">🗑️</button></div>';
  }).join('');
}

// =======================================================
// VERSIONES
// =======================================================
function renderVersiones(){
  const tb=document.getElementById('tbody-ver');
  if(!DB.versiones.length){tb.innerHTML='<tr><td colspan="5" class="empty">Sin versiones</td></tr>';return;}
  tb.innerHTML=DB.versiones.map((v,i)=>`<tr>
    <td style="font-family:monospace;font-weight:700">${v.ver}</td>
    <td>${verPill(v.tipo)}</td><td>${v.fecha}</td><td>${v.notas||'—'}</td>
    <td><button class="btn btn-sm" style="color:var(--red)" onclick="elimVer(${i})">🗑️</button></td>
  </tr>`).join('');
}
function modalVersion(){
  openModal('Nueva versión de software',`
    <div class="fg3">
      <div class="fg"><label>Versión *</label><input id="v-v" placeholder="v2.5.0" style="font-family:monospace"></div>
      <div class="fg"><label>Tipo</label><select id="v-t"><option>Mayor</option><option>Menor</option><option>Patch</option></select></div>
      <div class="fg"><label>Fecha</label><input id="v-f" type="date" value="${today()}"></div>
      <div class="fg full"><label>Notas / cambios</label><textarea id="v-n" placeholder="Descripción de los cambios..."></textarea></div>
    </div>`,()=>{
    const v=document.getElementById('v-v').value.trim();
    if(!v){alert('La versión es obligatoria.');return false;}
    DB.versiones.unshift({ver:v,tipo:document.getElementById('v-t').value,fecha:document.getElementById('v-f').value,notas:document.getElementById('v-n').value});
    save();renderVersiones();return true;
  });
}
function elimVer(i){if(!confirm('¿Eliminar versión?'))return;DB.versiones.splice(i,1);save();renderVersiones();}

// =======================================================
// TIPOS SENSOR
// =======================================================
function renderTipos(){
  document.getElementById('tipos-list').innerHTML=DB.tipos.map((t,i)=>`
    <div style="display:inline-flex;align-items:center;gap:6px;background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:5px 12px;font-size:12px">
      ${t}<button style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;line-height:1;padding:0" onclick="elimTipo(${i})">×</button>
    </div>`).join('');
}
function agregarTipo(){
  const inp=document.getElementById('nuevo-tipo');const v=inp.value.trim();
  if(!v)return;if(DB.tipos.includes(v)){alert('Ya existe ese tipo.');return;}
  DB.tipos.push(v);save();inp.value='';renderTipos();
}
function elimTipo(i){if(!confirm('¿Eliminar tipo de sensor?'))return;DB.tipos.splice(i,1);save();renderTipos();}

// =======================================================
// SNAPSHOTS LOCALES Y CIERRE SEGURO (mismo patrón que Control Financiero)
// =======================================================
const VSS_BKUP_KEY = 'riego_backups';
const VSS_BKUP_MAX = 10;

function vssCargarSnapshots(){
  try { return JSON.parse(localStorage.getItem(VSS_BKUP_KEY)) || []; } catch(e){ return []; }
}
function vssGuardarSnapshots(bkups){
  try { localStorage.setItem(VSS_BKUP_KEY, JSON.stringify(bkups)); } catch(e){}
}
function vssHacerSnapshot(manual){
  try {
    const bkups = vssCargarSnapshots();
    bkups.unshift({ ts: Date.now(), manual: !!manual, label: manual?'Manual':'Automático', data: JSON.stringify(DB) });
    // Mantener máximo VSS_BKUP_MAX: priorizar borrar automáticos viejos antes que manuales
    if(bkups.length > VSS_BKUP_MAX){
      const idxAuto = [...bkups.map(function(b,i){return {b:b,i:i};})].reverse().find(function(x){return !x.b.manual;});
      if(idxAuto) bkups.splice(idxAuto.i, 1); else bkups.pop();
    }
    vssGuardarSnapshots(bkups);
    return true;
  } catch(e){ console.warn('Snapshot:', e); return false; }
}
function vssFmtTs(ts){
  const d = new Date(ts);
  return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', {hour:'2-digit',minute:'2-digit',hour12:false});
}
function vssRestaurarSnapshot(ts){
  if(!confirm('¿Restaurar este snapshot? Los datos actuales se guardarán como snapshot antes de restaurar.')) return;
  vssHacerSnapshot(false); // guardar estado actual antes de pisarlo
  const bkups = vssCargarSnapshots();
  const bkup = bkups.find(function(b){return b.ts===ts;});
  if(!bkup){ alert('Snapshot no encontrado'); return; }
  try {
    DB = JSON.parse(bkup.data);
    save();
    document.getElementById('modal-vss-snapshots')?.remove();
    alert('✅ Snapshot restaurado: ' + vssFmtTs(ts) + '\nSe recargará la aplicación.');
    location.reload();
  } catch(e){ alert('Error al restaurar: ' + e.message); }
}
function vssBorrarSnapshot(ts){
  if(!confirm('¿Eliminar este snapshot?')) return;
  vssGuardarSnapshots(vssCargarSnapshots().filter(function(b){return b.ts!==ts;}));
  vssMostrarSnapshots();
}
function vssMostrarSnapshots(){
  document.getElementById('modal-vss-snapshots')?.remove();
  const bkups = vssCargarSnapshots();
  const rows = bkups.length ? bkups.map(function(b){
    return '<tr>'+
      '<td style="padding:8px 6px;font-size:13px">'+vssFmtTs(b.ts)+'</td>'+
      '<td style="padding:8px 6px;font-size:12px;color:'+(b.manual?'#1B5E20':'#666')+'">'+b.label+'</td>'+
      '<td style="padding:8px 6px;text-align:right">'+
        '<button onclick="vssRestaurarSnapshot('+b.ts+')" style="background:#1A4A63;color:#fff;border:none;border-radius:4px;padding:3px 10px;font-size:12px;cursor:pointer;margin-right:4px">Restaurar</button>'+
        '<button onclick="vssBorrarSnapshot('+b.ts+')" style="background:#B71C1C;color:#fff;border:none;border-radius:4px;padding:3px 8px;font-size:12px;cursor:pointer">✕</button>'+
      '</td></tr>';
  }).join('') : '<tr><td colspan="3" style="padding:16px;text-align:center;color:#AAA">Sin snapshots guardados</td></tr>';
  const ov = document.createElement('div');
  ov.id = 'modal-vss-snapshots';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:3000;display:flex;align-items:center;justify-content:center';
  ov.innerHTML =
    '<div style="background:#fff;border-radius:10px;padding:24px;min-width:420px;max-width:90vw;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'+
        '<h3 style="margin:0;font-size:16px">💾 Snapshots locales</h3>'+
        '<button onclick="document.getElementById(\'modal-vss-snapshots\').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#666">✕</button>'+
      '</div>'+
      '<p style="font-size:12px;color:#666;margin:0 0 12px">Backups guardados automáticamente en este dispositivo (máx. '+VSS_BKUP_MAX+').</p>'+
      '<table style="width:100%;border-collapse:collapse;font-size:13px">'+
        '<thead><tr style="border-bottom:2px solid #DDD">'+
          '<th style="padding:6px;text-align:left;font-size:12px;color:#666">Fecha</th>'+
          '<th style="padding:6px;text-align:left;font-size:12px;color:#666">Tipo</th>'+
          '<th style="padding:6px;text-align:right;font-size:12px;color:#666">Acción</th>'+
        '</tr></thead><tbody>'+rows+'</tbody>'+
      '</table>'+
      '<div style="margin-top:16px;display:flex;justify-content:space-between;align-items:center">'+
        '<button onclick="vssHacerSnapshot(true);vssMostrarSnapshots();" style="background:#256282;color:#fff;border:none;border-radius:4px;padding:6px 14px;font-size:13px;cursor:pointer">📸 Guardar snapshot ahora</button>'+
        '<button onclick="document.getElementById(\'modal-vss-snapshots\').remove()" style="background:#F2F2F2;color:#222;border:none;border-radius:4px;padding:6px 14px;font-size:13px;cursor:pointer">Cerrar</button>'+
      '</div>'+
    '</div>';
  document.body.appendChild(ov);
}
function vssSalir(){
  const ok = vssHacerSnapshot(true);
  var lineas = '📦 Backup al salir\n\n'+(ok?'✅':'❌')+' Snapshot local: '+(ok?'guardado':'error');
  if(window._vssFolderHandle){ lineas += '\n⏳ Carpeta local: guardando...'; vssBackupEnCarpeta(window._vssFolderHandle); }
  else lineas += '\n➖ Carpeta local: no vinculada';
  if(vssGToken || vssGTokenCargarLocal()){
    lineas += '\n⏳ Google Drive: sincronizando...';
    if(_vssSyncPendiente) vssSyncSilencioso();
  } else {
    lineas += '\n➖ Google Drive: no conectado';
  }
  alert(lineas);
  window.close();
}

// ═══════════════════════════════════════════════════════════════
// CARPETA LOCAL — File System Access API + IndexedDB (mismo patrón que Finanzas)
// ═══════════════════════════════════════════════════════════════
const VSS_FOLDER_DB    = 'riego-folder-db';
const VSS_FOLDER_STORE = 'handles';
const VSS_FOLDER_KEY   = 'carpeta';
const VSS_MAX_BK       = 7;

function vssAbrirFolderDB(){
  return new Promise(function(res, rej){
    const req = indexedDB.open(VSS_FOLDER_DB, 1);
    req.onupgradeneeded = function(e){ e.target.result.createObjectStore(VSS_FOLDER_STORE); };
    req.onsuccess = function(e){ res(e.target.result); };
    req.onerror = function(e){ rej(e.target.error); };
  });
}
async function vssGuardarHandle(handle){
  try {
    const db = await vssAbrirFolderDB();
    const tx = db.transaction(VSS_FOLDER_STORE, 'readwrite');
    tx.objectStore(VSS_FOLDER_STORE).put(handle, VSS_FOLDER_KEY);
    await new Promise(function(res, rej){ tx.oncomplete = res; tx.onerror = rej; });
    db.close();
  } catch(e){ console.warn('vssGuardarHandle:', e); }
}
async function vssLeerHandle(){
  try {
    const db = await vssAbrirFolderDB();
    const tx = db.transaction(VSS_FOLDER_STORE, 'readonly');
    const req = tx.objectStore(VSS_FOLDER_STORE).get(VSS_FOLDER_KEY);
    const handle = await new Promise(function(res, rej){ req.onsuccess=function(){res(req.result);}; req.onerror=rej; });
    db.close();
    return handle || null;
  } catch(e){ return null; }
}
async function vssVerificarPermiso(handle){
  try {
    const opts = { mode: 'readwrite' };
    if(await handle.queryPermission(opts) === 'granted') return true;
    if(await handle.requestPermission(opts) === 'granted') return true;
    return false;
  } catch(e){ return false; }
}
// Solo consulta el permiso sin pedirlo — no requiere gesto del usuario, segura para llamar en automático.
async function vssPermisoOtorgado(handle){
  try { return (await handle.queryPermission({mode:'readwrite'})) === 'granted'; }
  catch(e){ return false; }
}
async function vssSeleccionarCarpeta(){
  if(!('showDirectoryPicker' in window)){
    alert('Tu navegador no soporta la selección de carpeta local. Usá Chrome o Brave.');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({mode:'readwrite'});
    await vssGuardarHandle(handle);
    window._vssFolderHandle = handle;
    vssActualizarEstadoCarpeta(handle.name);
    await vssBackupEnCarpeta(handle);
    alert('📁 Carpeta vinculada: '+handle.name+'\nSe va a actualizar un backup ahí cada vez que se guarden cambios.');
  } catch(e){
    if(e.name !== 'AbortError') console.warn('vssSeleccionarCarpeta:', e);
  }
}
function vssActualizarEstadoCarpeta(nombre){
  const st = document.getElementById('vss-carpeta-status');
  if(st){ st.textContent = nombre ? ('📁 Vinculada: '+nombre) : '➖ No vinculada'; st.style.color = nombre ? 'var(--green)' : 'var(--text2)'; }
}
async function vssBackupEnCarpeta(handle){
  if(!handle) return;
  const ok = await vssVerificarPermiso(handle);
  if(!ok) return;
  try {
    const nombre = 'riego_backup_'+today()+'.json';
    const fileHandle = await handle.getFileHandle(nombre, {create:true});
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(DB, null, 2));
    await writable.close();
    const entries = [];
    for await (const entry of handle.values()){
      if(entry.kind==='file' && entry.name.startsWith('riego_backup_') && entry.name.endsWith('.json')) entries.push(entry.name);
    }
    entries.sort().reverse();
    for(const old of entries.slice(VSS_MAX_BK)){
      try { await handle.removeEntry(old); } catch(e){}
    }
    vssActualizarEstadoCarpeta(handle.name);
  } catch(e){ console.warn('vssBackupEnCarpeta:', e); }
}
async function vssRestaurarCarpeta(){
  try {
    const handle = await vssLeerHandle();
    if(!handle) return;
    window._vssFolderHandlePendiente = handle;
    const ok = await vssPermisoOtorgado(handle);
    if(!ok){ vssMostrarBannerReauthCarpeta(handle); return; }
    window._vssFolderHandle = handle;
    vssActualizarEstadoCarpeta(handle.name);
  } catch(e){ console.warn('vssRestaurarCarpeta:', e); }
}
// Banner discreto: el permiso venció y hace falta un click real del usuario para renovarlo
// (la API no permite renovarlo en automático).
function vssMostrarBannerReauthCarpeta(handle){
  if(document.getElementById('vss-reauth-carpeta')) return;
  const b = document.createElement('div');
  b.id = 'vss-reauth-carpeta';
  b.style.cssText = 'position:fixed;bottom:16px;left:16px;background:#1A1A1A;color:#fff;padding:10px 14px;border-radius:8px;z-index:9998;display:flex;align-items:center;gap:10px;box-shadow:0 4px 20px rgba(0,0,0,.3);font-size:12.5px;max-width:340px';
  b.innerHTML = '🔒 La carpeta local ('+handle.name+') necesita que confirmes el acceso de nuevo.'+
    '<button id="vss-reauth-btn" style="background:#256282;color:#fff;border:none;border-radius:6px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">Reautorizar</button>'+
    '<span id="vss-reauth-x" style="cursor:pointer;color:#AAA;padding:0 2px">✕</span>';
  document.body.appendChild(b);
  document.getElementById('vss-reauth-x').onclick = function(){ b.remove(); };
  document.getElementById('vss-reauth-btn').onclick = async function(){
    try {
      const granted = (await handle.requestPermission({mode:'readwrite'})) === 'granted';
      if(granted){ window._vssFolderHandle = handle; vssActualizarEstadoCarpeta(handle.name); b.remove(); }
      else alert('No se otorgó el permiso. Podés vincular la carpeta de nuevo con "📂 Elegir carpeta local".');
    } catch(e){ alert('Error al reautorizar: '+e.message); }
  };
}

// =======================================================
// BACKUP
// =======================================================

function borrarExceptoLogistica(){
  if(!confirm('\u26a0\ufe0f Esto borrará clientes, presupuestos, fondos, fabricación e instalaciones.\n\nSe PRESERVA toda la logística: catálogo, stock, proveedores, OC, movimientos de stock, kits y configuración.\n\n¿Confirmás?')) return;
  if(!confirm('Última confirmación. Esta acción no se puede deshacer.')) return;

  // Preserve logistica
  var componentes = DB.componentes;
  var proveedores = DB.proveedores;
  var movimientos = DB.movimientos;
  var ordenes = DB.ordenes;
  var kit = DB.kit;
  var kitVersion = DB.kitVersion;
  var kitFecha = DB.kitFecha;
  var kitinst = DB.kitinst;
  var kitinstVersion = DB.kitinstVersion;
  var kitinstFecha = DB.kitinstFecha;
  var versiones = DB.versiones;
  var tipos = DB.tipos;
  var config = DB.config;
  var lineasProducto = DB.lineasProducto;

  // Clear operational
  DB.clientes = [];
  DB.presupuestos = [];
  DB.fondos = [];
  DB.gestiones = [];
  DB.fabricacion = [];
  DB.instalaciones = [];
  DB.nid = 1;

  // Restore
  DB.componentes = componentes;
  DB.proveedores = proveedores;
  DB.movimientos = movimientos;
  DB.ordenes = ordenes;
  DB.kit = kit;
  DB.kitVersion = kitVersion;
  DB.kitFecha = kitFecha;
  DB.kitinst = kitinst;
  DB.kitinstVersion = kitinstVersion;
  DB.kitinstFecha = kitinstFecha;
  DB.versiones = versiones;
  DB.tipos = tipos;
  DB.config = config;
  DB.lineasProducto = lineasProducto;

  save();
  alert('\u2705 Datos borrados. Logística preservada.');
  location.reload();
}

function reiniciarOperativo(){
  if(!confirm('⚠️ Esto borrará todos los datos operativos (clientes, presupuestos, movimientos, OC, fabricación, instalaciones y finanzas).\n\nSe PRESERVAN: catálogo, proveedores, configuración, kits y versiones SW.\n\n¿Confirmás?')) return;
  if(!confirm('Última confirmación. Esta acción no se puede deshacer.')) return;

  // Preserve
  var config = DB.config;
  var componentes = DB.componentes;
  var proveedores = DB.proveedores;
  var versiones = DB.versiones;
  var tipos = DB.tipos;
  var kit = DB.kit;
  var kitVersion = DB.kitVersion;
  var kitFecha = DB.kitFecha;
  var kitinst = DB.kitinst;
  var kitinstVersion = DB.kitinstVersion;
  var kitinstFecha = DB.kitinstFecha;
  var lineasProducto = DB.lineasProducto;

  // Reset operational data
  DB.clientes = [];
  DB.presupuestos = [];
  DB.movimientos = [];
  DB.ordenes = [];
  DB.gestiones = [];
  DB.fondos = [];
  DB.fabricacion = [];
  DB.instalaciones = [];
  DB.nid = 1;

  // Restore preserved
  DB.config = config;
  DB.componentes = componentes;
  DB.proveedores = proveedores;
  DB.versiones = versiones;
  DB.tipos = tipos;
  DB.kit = kit;
  DB.kitVersion = kitVersion;
  DB.kitFecha = kitFecha;
  DB.kitinst = kitinst;
  DB.kitinstVersion = kitinstVersion;
  DB.kitinstFecha = kitinstFecha;
  DB.lineasProducto = lineasProducto;

  save();
  alert('✅ Datos operativos reiniciados. Catálogo, proveedores y configuración preservados.');
  location.reload();
}

function borrarTodo(){
  if(!confirm('¿Borrar TODOS los datos? Esta accion no se puede deshacer.')) return;
  if(!confirm('Ultima confirmacion. ¿Estas seguro?')) return;
  localStorage.removeItem(SKEY);
  alert('Datos borrados. La app se reiniciara.');
  location.reload();
}

function exportarJSON(){
  const fecha=today();
  const json=JSON.stringify(DB,null,2);
  const blob=new Blob([json],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download='riego_backup_'+fecha+'.json';a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════
// GOOGLE DRIVE — backup real, mismo patrón que Control Financiero
// ═══════════════════════════════════════════════════════════════
const GDRIVE_CLIENT_ID='1049169592532-is5j1j4s1bmgrc9tsq48slrgul8fbj17.apps.googleusercontent.com';
const GDRIVE_SCOPE='https://www.googleapis.com/auth/drive.file';
const VSS_DRIVE_FOLDER='RiegoAdaptativo';
const VSS_GTOKEN_KEY='riego_gtoken';
const VSS_GTOKEN_EXP_KEY='riego_gtoken_exp';
const VSS_GTOKEN_SCOPE_KEY='riego_gtoken_scope_v';
const VSS_GTOKEN_SCOPE_VERSION='1';
let vssGToken=null;
let _vssFolderId=null;
let _vssDriveFileId=null;      // id del archivo único de autosync, para sobreescribir en vez de duplicar
let _vssSyncPendiente=false;
let _vssSyncActivo=false;
let _vssSyncTimer=null;

function vssGTokenGuardar(token, expiresInSec){
  const exp = Date.now() + (expiresInSec||3500)*1000;
  try {
    localStorage.setItem(VSS_GTOKEN_KEY, token);
    localStorage.setItem(VSS_GTOKEN_EXP_KEY, String(exp));
    localStorage.setItem(VSS_GTOKEN_SCOPE_KEY, VSS_GTOKEN_SCOPE_VERSION);
  } catch(e){}
  vssGToken = token;
}
function vssGTokenCargarLocal(){
  try {
    const t = localStorage.getItem(VSS_GTOKEN_KEY);
    const exp = parseInt(localStorage.getItem(VSS_GTOKEN_EXP_KEY)||'0');
    const scopeV = localStorage.getItem(VSS_GTOKEN_SCOPE_KEY);
    if(t && exp && Date.now() < exp-60000 && scopeV===VSS_GTOKEN_SCOPE_VERSION){ vssGToken=t; return true; }
  } catch(e){}
  return false;
}
function vssGTokenLimpiar(){
  vssGToken = null;
  try { localStorage.removeItem(VSS_GTOKEN_KEY); localStorage.removeItem(VSS_GTOKEN_EXP_KEY); localStorage.removeItem(VSS_GTOKEN_SCOPE_KEY); } catch(e){}
}
// Busca (o crea) la carpeta visible "RiegoAdaptativo" en el Drive del usuario
function vssDriveEnsureFolder(token, cb){
  if(_vssFolderId){ cb(_vssFolderId); return; }
  const q = encodeURIComponent("name='"+VSS_DRIVE_FOLDER+"' and mimeType='application/vnd.google-apps.folder' and trashed=false");
  fetch('https://www.googleapis.com/drive/v3/files?q='+q+'&fields=files(id,name)', {headers:{Authorization:'Bearer '+token}})
    .then(function(r){return r.json();}).then(function(data){
      if(data.files && data.files.length){ _vssFolderId=data.files[0].id; cb(_vssFolderId); return; }
      fetch('https://www.googleapis.com/drive/v3/files', {method:'POST', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}, body:JSON.stringify({name:VSS_DRIVE_FOLDER, mimeType:'application/vnd.google-apps.folder'})})
        .then(function(r){return r.json();}).then(function(f){ _vssFolderId=f.id; cb(_vssFolderId); })
        .catch(function(){ vssSyncSetBadge('err'); });
    }).catch(function(){ vssSyncSetBadge('err'); });
}
// Igual que vssDriveEnsureFolder, pero para una carpeta con nombre arbitrario
// (usado para RiegoAdaptativoRelevamiento / RiegoAdaptativoMantenimiento, cacheado por nombre).
const _vssFolderIdsPorNombre = {};
function vssDriveEnsureFolderNamed(token, nombreCarpeta, cb){
  if(_vssFolderIdsPorNombre[nombreCarpeta]){ cb(_vssFolderIdsPorNombre[nombreCarpeta]); return; }
  const q = encodeURIComponent("name='"+nombreCarpeta+"' and mimeType='application/vnd.google-apps.folder' and trashed=false");
  fetch('https://www.googleapis.com/drive/v3/files?q='+q+'&fields=files(id,name)', {headers:{Authorization:'Bearer '+token}})
    .then(function(r){return r.json();}).then(function(data){
      if(data.files && data.files.length){ _vssFolderIdsPorNombre[nombreCarpeta]=data.files[0].id; cb(_vssFolderIdsPorNombre[nombreCarpeta]); return; }
      fetch('https://www.googleapis.com/drive/v3/files', {method:'POST', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}, body:JSON.stringify({name:nombreCarpeta, mimeType:'application/vnd.google-apps.folder'})})
        .then(function(r){return r.json();}).then(function(f){ _vssFolderIdsPorNombre[nombreCarpeta]=f.id; cb(_vssFolderIdsPorNombre[nombreCarpeta]); })
        .catch(function(){ alert('Error al crear/buscar la carpeta '+nombreCarpeta+' en Drive.'); });
    }).catch(function(){ alert('Error al buscar la carpeta '+nombreCarpeta+' en Drive.'); });
}
// Busca un archivo por nombre dentro de una carpeta ya resuelta (folderId). cb(fileOrNull)
function vssDriveBuscarArchivo(token, folderId, nombreArchivo, cb){
  const q = encodeURIComponent("name='"+nombreArchivo+"' and '"+folderId+"' in parents and trashed=false");
  fetch('https://www.googleapis.com/drive/v3/files?q='+q+'&fields=files(id,name,modifiedTime)', {headers:{Authorization:'Bearer '+token}})
    .then(function(r){return r.json();}).then(function(data){ cb((data.files&&data.files[0])||null); })
    .catch(function(){ cb(null); });
}
// Baja y parsea el JSON de un archivo por su id. cb(objOrNull)
function vssDriveBajarJSON(token, fileId, cb){
  fetch('https://www.googleapis.com/drive/v3/files/'+fileId+'?alt=media', {headers:{Authorization:'Bearer '+token}})
    .then(function(r){return r.json();}).then(cb).catch(function(){ cb(null); });
}
// Sube/actualiza un archivo con nombre propio dentro de una carpeta (crea si no existe). cb(fileId)
function vssDriveSubirArchivo(token, folderId, nombreArchivo, obj, cb){
  vssDriveBuscarArchivo(token, folderId, nombreArchivo, function(existente){
    const data = JSON.stringify(obj);
    if(existente){
      fetch('https://www.googleapis.com/upload/drive/v3/files/'+existente.id+'?uploadType=media', {method:'PATCH', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}, body:data})
        .then(function(r){return r.json();}).then(function(f){ cb(f.id); }).catch(function(e){ alert('Error al subir a Drive: '+e.message); });
    } else {
      const meta = JSON.stringify({name:nombreArchivo, parents:[folderId]});
      const form = new FormData();
      form.append('metadata', new Blob([meta],{type:'application/json'}));
      form.append('file', new Blob([data],{type:'application/json'}));
      fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {method:'POST', headers:{Authorization:'Bearer '+token}, body:form})
        .then(function(r){return r.json();}).then(function(f){ cb(f.id); }).catch(function(e){ alert('Error al subir a Drive: '+e.message); });
    }
  });
}
function vssDriveCargarGoogle(cb){
  if(typeof google!=='undefined'){ cb(); return; }
  const s=document.createElement('script'); s.src='https://accounts.google.com/gsi/client';
  s.onload=cb; s.onerror=function(){ alert('No se pudo cargar Google. Verificá la conexión.'); };
  document.head.appendChild(s);
}
function vssDriveGetToken(cb){
  if(vssGTokenCargarLocal()){ cb(vssGToken); return; }
  vssDriveCargarGoogle(function(){
    if(vssGToken){ cb(vssGToken); return; }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GDRIVE_CLIENT_ID, scope: GDRIVE_SCOPE, hint:'', prompt:'',
      callback: function(resp){
        if(resp.error==='interaction_required' || resp.error==='user_logged_out'){
          const c2 = google.accounts.oauth2.initTokenClient({client_id:GDRIVE_CLIENT_ID, scope:GDRIVE_SCOPE, hint:'', callback:function(r2){
            if(r2.error){ alert('Error: '+r2.error); return; }
            vssGTokenGuardar(r2.access_token, r2.expires_in); cb(vssGToken);
          }});
          c2.requestAccessToken(); return;
        }
        if(resp.error){ alert('Error Google: '+resp.error); return; }
        vssGTokenGuardar(resp.access_token, resp.expires_in);
        vssSyncSetBadge(_vssSyncPendiente?'pend':'noauth');
        cb(vssGToken);
      }
    });
    client.requestAccessToken({prompt:''});
  });
}
function vssDriveSubir(){
  vssDriveGetToken(function(token){
    vssDriveEnsureFolder(token, function(folderId){
      const a=new Date();
      const ts=a.getFullYear()+String(a.getMonth()+1).padStart(2,'0')+String(a.getDate()).padStart(2,'0')+'_'+String(a.getHours()).padStart(2,'0')+String(a.getMinutes()).padStart(2,'0');
      const nombre='backup_riego_'+ts+'.json';
      const data=JSON.stringify(DB);
      const meta=JSON.stringify({name:nombre, parents:[folderId]});
      const form=new FormData();
      form.append('metadata', new Blob([meta],{type:'application/json'}));
      form.append('file', new Blob([data],{type:'application/json'}));
      fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {method:'POST', headers:{Authorization:'Bearer '+token}, body:form})
        .then(function(r){return r.json();}).then(function(f){
          if(f.id){ _vssSyncPendiente=false; vssSyncSetBadge('ok'); alert('✅ Backup guardado en Drive: '+nombre); }
          else { alert('Error al subir: '+JSON.stringify(f)); vssGTokenLimpiar(); }
        }).catch(function(e){ alert('Error: '+e.message); vssGTokenLimpiar(); });
    });
  });
}
function vssDriveRestaurar(){
  vssDriveGetToken(function(token){
    vssDriveEnsureFolder(token, function(folderId){
      const q = encodeURIComponent("'"+folderId+"' in parents and trashed=false");
      fetch('https://www.googleapis.com/drive/v3/files?q='+q+'&fields=files(id,name,modifiedTime)&orderBy=modifiedTime+desc&pageSize=50', {headers:{Authorization:'Bearer '+token}})
        .then(function(r){return r.json();}).then(function(data){
          const arch=(data.files||[]).filter(function(f){return f.name.startsWith('backup_');});
          vssMostrarModalDrive(arch, token);
        }).catch(function(e){ alert('Error al listar Drive: '+e.message); vssGTokenLimpiar(); });
    });
  });
}
function vssMostrarModalDrive(arch, token){
  document.getElementById('modal-vss-drive')?.remove();
  const rows = arch.length ? arch.map(function(f){
    const fecha = new Date(f.modifiedTime).toLocaleString('es-AR');
    const esAuto = f.name==='backup_autosync.json';
    const label = esAuto ? '🔄 Autosync — '+fecha : f.name;
    return '<div onclick="vssDriveCargar(\''+f.id+'\',\''+f.name.replace(/'/g,"\\'")+'\',vssGToken)" '+
      'style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:6px;border:1px solid #DDD;margin-bottom:8px;cursor:pointer" '+
      'onmouseover="this.style.background=\'#F7F7F7\'" onmouseout="this.style.background=\'\'">'+
      '<div><div style="font-size:13px;font-weight:700;color:#222">'+label+'</div><div style="font-size:11px;color:#666">'+fecha+(esAuto?' · sync automático':'')+'</div></div>'+
      '<span style="font-size:11px;color:#256282;font-weight:700">Restaurar →</span></div>';
  }).join('') : '<p style="color:#666;text-align:center;padding:20px">Sin backups en Drive. Usá ☁️ Subir para crear el primero.</p>';
  const ov = document.createElement('div');
  ov.id='modal-vss-drive';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:3000;display:flex;align-items:center;justify-content:center';
  ov.innerHTML =
    '<div style="background:#fff;border-radius:12px;width:480px;max-width:95vw;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)">'+
      '<div style="background:#1A1A1A;padding:16px 20px;display:flex;align-items:center;justify-content:space-between">'+
        '<h3 style="margin:0;color:#fff;font-size:15px">☁️ Backups en Google Drive</h3>'+
        '<button onclick="document.getElementById(\'modal-vss-drive\').remove()" style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer">✕</button>'+
      '</div>'+
      '<div style="padding:20px">'+rows+'</div>'+
      '<div style="padding:16px 20px;border-top:1px solid #DDD;display:flex;justify-content:flex-end">'+
        '<button onclick="document.getElementById(\'modal-vss-drive\').remove()" style="background:#F2F2F2;color:#222;border:none;border-radius:4px;padding:6px 14px;font-size:13px;cursor:pointer">Cerrar</button>'+
      '</div>'+
    '</div>';
  document.body.appendChild(ov);
}
function vssDriveCargar(id, nombre, token){
  if(!confirm('¿Restaurar "'+nombre+'"? Se reemplazarán todos los datos actuales.')) return;
  document.getElementById('modal-vss-drive')?.remove();
  fetch('https://www.googleapis.com/drive/v3/files/'+id+'?alt=media', {headers:{Authorization:'Bearer '+token}})
    .then(function(r){return r.json();}).then(function(res){
      if(!res.clientes){ alert('Backup inválido.'); return; }
      DB = res; save();
      alert('✅ Backup restaurado: '+nombre+'\nSe recargará la aplicación.');
      location.reload();
    }).catch(function(e){ alert('Error al descargar: '+e.message); });
}
function vssSyncSetBadge(estado){
  const b = document.getElementById('vss-drive-badge');
  if(!b) return;
  if(estado==='ok'){ b.textContent='✅ Drive: sincronizado'; b.style.color='var(--green)'; }
  else if(estado==='pend'){ b.textContent='⏳ Drive: cambios sin sincronizar'; b.style.color='#7B4F00'; }
  else if(estado==='sync'){ b.textContent='☁️ Drive: sincronizando...'; b.style.color='var(--blue)'; }
  else if(estado==='err'){ b.textContent='⚠️ Drive: error de sincronización'; b.style.color='var(--red)'; }
  else if(estado==='noauth'){ b.textContent='➖ Drive: sin conectar'; b.style.color='var(--text2)'; }
}
// Debounce: se llama en cada save(); espera 30s de calma antes de sincronizar de verdad
function vssSyncDebounce(){
  if(!vssGToken) vssGTokenCargarLocal();
  if(!vssGToken){ vssSyncSetBadge('noauth'); return; }
  _vssSyncPendiente = true;
  vssSyncSetBadge('pend');
  clearTimeout(_vssSyncTimer);
  _vssSyncTimer = setTimeout(vssSyncSilencioso, 30000);
}
async function vssSyncSilencioso(){
  if(_vssSyncActivo){ _vssSyncActivo = false; }
  if(!vssGToken) return;
  _vssSyncActivo = true;
  vssSyncSetBadge('sync');
  try {
    const data = JSON.stringify(DB);
    const folderId = await new Promise(function(res){ vssDriveEnsureFolder(vssGToken, res); });
    if(!_vssDriveFileId){
      const q = encodeURIComponent("name='backup_autosync.json' and '"+folderId+"' in parents and trashed=false");
      const listR = await fetch('https://www.googleapis.com/drive/v3/files?q='+q+'&fields=files(id,name)', {headers:{Authorization:'Bearer '+vssGToken}});
      if(listR.ok){
        const listD = await listR.json();
        if(listD.files && listD.files.length>0) _vssDriveFileId = listD.files[0].id;
      } else if(listR.status===401){ vssGTokenLimpiar(); _vssSyncActivo=false; vssSyncSetBadge('err'); return; }
    }
    let resp;
    if(_vssDriveFileId){
      resp = await fetch('https://www.googleapis.com/upload/drive/v3/files/'+_vssDriveFileId+'?uploadType=media', {method:'PATCH', headers:{Authorization:'Bearer '+vssGToken,'Content-Type':'application/json'}, body:data});
    } else {
      const meta = JSON.stringify({name:'backup_autosync.json', parents:[folderId]});
      const form = new FormData();
      form.append('metadata', new Blob([meta],{type:'application/json'}));
      form.append('file', new Blob([data],{type:'application/json'}));
      resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {method:'POST', headers:{Authorization:'Bearer '+vssGToken}, body:form});
    }
    if(resp.ok){
      const f = await resp.json();
      if(f.id) _vssDriveFileId = f.id;
      _vssSyncPendiente = false;
      vssSyncSetBadge('ok');
    } else {
      if(resp.status===401){ vssGTokenLimpiar(); _vssDriveFileId=null; }
      vssSyncSetBadge('err');
    }
  } catch(e){ vssSyncSetBadge('err'); }
  _vssSyncActivo = false;
}

function importarJSON(){
  const file=document.getElementById('import-file').files[0];
  if(!file){alert('Seleccioná un archivo JSON primero.');return;}
  if(!confirm('⚠️ Esto reemplazará TODOS los datos actuales. ¿Confirmás?'))return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      if(!data.clientes||!data.versiones){alert('Archivo inválido. No es un backup de Riego Adaptativo.');return;}
      DB=data;save();
      alert('✔ Backup restaurado correctamente. Se recargará la aplicación.');
      location.reload();
    }catch(err){alert('Error al leer el archivo: '+err.message);}
  };
  reader.readAsText(file);
}

function renderBackupInfo(){
  const c=DB.clientes;
  const devs=c.reduce((a,x)=>a+((x.zigbee&&x.zigbee.length)||0),0);
  const otas=c.reduce((a,x)=>a+((x.ota&&x.ota.length)||0),0);
  const mantos=c.reduce((a,x)=>a+((x.mant&&x.mant.length)||0),0);
  const kb=Math.round(JSON.stringify(DB).length/1024);
  const snaps=vssCargarSnapshots().length;
  document.getElementById('backup-info').innerHTML=`
    ${fbox('Clientes totales',c.length)}
    ${fbox('Sensores de riego',devs)}
    ${fbox('Actualizaciones OTA',otas)}
    ${fbox('Visitas de mantenimiento',mantos)}
    ${fbox('Versiones SW',DB.versiones.length)}
    ${fbox('Tamaño de datos',kb+' KB')}
    ${fbox('Snapshots locales',snaps+' / '+VSS_BKUP_MAX)}`;
}

// =======================================================
// MODAL GEN=RICO
// =======================================================
var _presDraftId=null; // id de un presupuesto recién creado por "Nuevo manual" que todavía no se guardó con datos
function openModal(title,body,onSave,soloVista){
  var footer = soloVista
    ? '<button class="btn" onclick="cerrarModal()">Cerrar</button>'
    : '<button class="btn" onclick="cerrarModal()">Cancelar</button><button class="btn btn-p" id="msave">✔ Guardar</button>';
  document.getElementById('mbox').innerHTML=`
    <div class="moverlay" onclick="if(event.target===this)cerrarModal()">
      <div class="modal">
        <div class="mhead"><h3>${title}</h3><button class="btn btn-sm" onclick="cerrarModal()">✕</button></div>
        <div class="mbody">${body}</div>
        <div class="mfoot">${footer}</div>
      </div>
    </div>`;
  if(!soloVista && onSave){
    document.getElementById('msave').onclick=function(){ if(onSave()!==false) cerrarModal(); };
  }
}
function cerrarModal(){
  // Si había un presupuesto recién creado por "Nuevo manual" y se cierra sin cargar
  // nada, se borra solo en vez de quedar como un registro vacío en la lista.
  if(_presDraftId){
    var p=DB.presupuestos.find(function(x){return x.id===_presDraftId;});
    var vacio=p && !p.nombre.trim() && !Object.values(p.precios||{}).some(function(i){return (parseFloat(i.cant)||0)>0;});
    if(vacio){
      DB.presupuestos=DB.presupuestos.filter(function(x){return x.id!==_presDraftId;});
      save();
      if(typeof renderPresupuestos==='function') renderPresupuestos();
    }
    _presDraftId=null;
  }
  document.getElementById('mbox').innerHTML='';
}

// =======================================================
// PWA
// =======================================================
let deferredPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();deferredPrompt=e;
  document.getElementById('install-btn').classList.add('show');
});
function instalarPWA(){
  if(!deferredPrompt)return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(()=>{
    deferredPrompt=null;
    document.getElementById('install-btn').classList.remove('show');
  });
}
window.addEventListener('appinstalled',()=>{
  document.getElementById('install-btn').classList.remove('show');
});

// Service Worker inline registration
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').then(reg=>{
    console.log('Riego Adaptativo SW OK');
  }).catch(e=>console.log('SW error:',e));
}


// PRESUPUESTOS ========================================
const LOGO_PDF = document.getElementById('logo-pdf-data').src;

function presEstadoPill(e){
  const mp={Borrador:'p-x',Enviado:'p-b',Aprobado:'p-g',Rechazado:'p-r'};
  return '<span class="pill '+(mp[e]||'p-x')+'">'+e+'</span>';
}

function renderPresupuestos(){
  const q=(document.getElementById('qp').value||'').toLowerCase();
  const fe=document.getElementById('fp-estado').value;
  const list=DB.presupuestos.filter(p=>{
    return(!q||(p.nombre+p.dir).toLowerCase().includes(q))&&(!fe||p.estado===fe);
  });
  const tb=document.getElementById('tbody-pres');
  if(!list.length){
    tb.innerHTML='<tr><td colspan="7" class="empty">Sin presupuestos. Importá un relevamiento desde la app móvil.</td></tr>';
    return;
  }
  tb.innerHTML=list.map(p=>{
    var clienteYaCreado=p.clienteId&&DB.clientes.find(function(c){return c.id===p.clienteId;});
const aprBtn=p.estado==='Aprobado'&&!clienteYaCreado?'<button class="btn btn-sm btn-g" onclick="convertirCliente('+p.id+')">👤 Cliente Activo</button>':(clienteYaCreado?'<span style="font-size:11px;color:var(--green)">✔ '+clienteYaCreado.nombre+'</span>' : '');
    return '<tr>'+
      '<td><strong>'+p.nombre+'</strong></td>'+
      '<td>'+p.dir+(p.barrio?' · '+p.barrio:'')+'</td>'+
      '<td>'+presLineaPill(p)+'</td>'+
      '<td>'+p.fecha+'</td>'+
      '<td>'+(p.tecnico||'—')+'</td>'+
      '<td>'+presEstadoPill(p.estado)+'</td>'+
      '<td style="display:flex;gap:4px;flex-wrap:wrap">'+
        '<button class="btn btn-sm" onclick="abrirEditorPres('+p.id+')">✏️ Editar</button>'+
        '<button class="btn btn-sm" onclick="verPresupuesto('+p.id+')">👁️ Ver</button>'+
        '<button class="btn btn-sm btn-p" onclick="generarPDF('+p.id+')">📄 PDF</button>'+
        '<button class="btn btn-sm" onclick="enviarEmailPres('+p.id+')" title="Enviar por email" style="color:var(--blue);border-color:var(--blue)">📧 Email</button>'+
        aprBtn+
        '<button class="btn btn-sm" style="color:var(--red)" onclick="eliminarPres('+p.id+')">🗑️</button>'+
      '</td>'+
    '</tr>';
  }).join('');
}

function procesarRelevamientosImportados(data){
  if(!data.relevamientos||data.tipo!=='riego_relevamiento') return null;
  let importados=0;
  data.relevamientos.forEach(r=>{
    const existe=DB.presupuestos.find(p=>p.relId===r.id&&p.nombre===r.nombre);
    if(!existe){
      DB.presupuestos.unshift({
        id:DB.nid++,relId:r.id,nombre:r.nombre,tel:r.tel,dir:r.dir,barrio:r.barrio||'',
        tipo:r.tipo,sup:r.sup,plantas:r.plantas,material:r.material,alarma:r.alarma,
        perro:r.perro,horario:r.horario,modelo:r.modelo,sensores:r.sensores,
        router:r.router,distancia:r.distancia,obstaculos:r.obstaculos,
        tecnico:r.tecnico,obs:r.obs,estado:r.estado||'Borrador',fecha:r.fecha||today()
      });
      importados++;
    }
  });
  save(); renderPresupuestos();
  return importados;
}
function importarRelevamiento(input){
  const file=input.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      const importados=procesarRelevamientosImportados(data);
      if(importados===null){ alert('Archivo inválido. No es un relevamiento válido.'); return; }
      input.value='';
      alert('✔ '+importados+' relevamiento'+(importados!==1?'s':'')+' importado'+(importados!==1?'s':'')+' correctamente.');
    }catch(err){alert('Error al leer el archivo: '+err.message);}
  };
  reader.readAsText(file);
}
function vssSyncRelevamientosDrive(){
  vssDriveGetToken(function(token){
    vssDriveEnsureFolderNamed(token, 'RiegoAdaptativoRelevamiento', function(folderId){
      vssDriveBuscarArchivo(token, folderId, 'relevamientos_pendientes.json', function(f){
        if(!f){ alert('No hay relevamientos pendientes en Drive todavía.'); return; }
        vssDriveBajarJSON(token, f.id, function(data){
          if(!data){ alert('Error al descargar el archivo de Drive.'); return; }
          const importados=procesarRelevamientosImportados(data);
          if(importados===null){ alert('El archivo en Drive no es un relevamiento válido.'); return; }
          alert('✔ '+importados+' relevamiento'+(importados!==1?'s':'')+' importado'+(importados!==1?'s':'')+' desde Drive.');
        });
      });
    });
  });
}

function cambiarEstadoPres(id,estado){
  const p=DB.presupuestos.find(x=>x.id===id);
  if(p){
    if(!p.historial) p.historial=[];
    p.historial.push({fecha:today(),de:p.estado,a:estado});
    p.estado=estado;
    if(estado==='Enviado') p.fechaEnviado=today();
    if(estado==='Aprobado') p.fechaAprobado=today();
    if(estado==='Rechazado') p.fechaRechazado=today();
    save();renderPresupuestos();
  }
}

function eliminarPres(id){
  if(!confirm('¿Eliminar este presupuesto?'))return;
  DB.presupuestos=DB.presupuestos.filter(x=>x.id!==id);
  save();renderPresupuestos();
}

function convertirCliente(id){
  const p=DB.presupuestos.find(function(x){return x.id===id;});
  if(!p)return;
  if(!confirm('¿Convertir el presupuesto de "'+p.nombre+'" en cliente?'))return;
  cerrarModal();
  // Si el presupuesto viene de un cliente potencial, promovemos ESE mismo registro
  // (se completa y pasa a Activo) en vez de crear uno nuevo desde cero.
  var potencial = p.clientePotencialId ? DB.clientes.find(function(c){return c.id===p.clientePotencialId;}) : null;
  window._promoveClienteId = potencial ? potencial.id : null;
  // Store data to load after navigation
  window._convData = p;
  goTo('alta');
  setTimeout(function(){
    var d = window._convData;
    if(!d) return;
    var f=function(eid,val){var el=document.getElementById(eid);if(el)el.value=val||'';};
    f('an', d.nombre);
    f('al', (potencial&&potencial.lote)||d.lote||'');
    f('aba', d.barrio||(potencial&&potencial.barrio)||'');
    f('at', d.tel);
    f('aemail', d.email||(potencial&&potencial.email)||'');
    f('aambientes', d.ambientes||'');
    f('af', today());
    f('av', '');
    f('amac', '');
    f('apin', '');
    f('achat', '');
    var am=document.getElementById('am');
    if(am) am.value=d.modelo||'AquaOne';
    // Store sensors and presId for guardarCliente to use
    window._convSensores = d.sensores||{};
    window._convPresId = d.id;
    window._convDir = d.dir||'';
    window._convData = null;
    alert(potencial
      ? 'Datos cargados desde el cliente potencial "'+potencial.nombre+'". Completá lote, MAC, PIN y versión para activarlo.'
      : 'Datos cargados desde presupuesto. Completá lote, MAC, PIN y versión. Los sensores del relevamiento se importarán automáticamente.');
  }, 300);
}

function verPresupuesto(id){
  const p=DB.presupuestos.find(function(x){return x.id===id;});
  if(!p)return;

  // Calcular total
  const sub=calcSubtotales(p);
  const bruto=Object.values(sub).reduce(function(a,v){return a+v;},0);
  const margenVal=bruto*(parseFloat(p.margen)||0)/100;
  const totalConMargen=bruto+margenVal;
  const descVal=parseFloat(p.descuento)||0;
  const totalFinal=totalConMargen-descVal;
  const tc=(DB.config&&DB.config.tipoCambio)||1;
  const totalUSD=tc>0?(totalFinal/tc).toFixed(2):0;

  // Sensores
  var sensorHtml='';
  const SENSOR_ITEMS=['Puerta','Ventana','PuertaVentana','Boton','Vibracion','Agua','Interruptor s/neutro','Interruptor router','Rele','Luz'];
  SENSOR_ITEMS.forEach(function(tipo){
    const s=p.sensores&&p.sensores[tipo];
    if(!s||s.qty===0)return;
    const ubics=(s.ubicaciones||[]).filter(Boolean).map(function(u){return '<li>'+u+'</li>';}).join('');
    sensorHtml+='<div style="margin-bottom:8px"><strong>'+tipo+'</strong>: '+s.qty+' unidad'+(s.qty>1?'es':'')+'<ul style="padding-left:16px;color:var(--text2);font-size:11px">'+ubics+'</ul></div>';
  });

  var cliExiste=p.clienteId&&DB.clientes.find(function(c){return c.id===p.clienteId;});
const aprBtn=p.estado==='Aprobado'&&!cliExiste?'<button class="btn btn-sm btn-g" onclick="convertirCliente('+p.id+');cerrarModal()">👤 Cliente Activo</button>':(cliExiste?'<span style="font-size:11px;color:var(--green)">✔ Cliente: '+cliExiste.nombre+'</span>':'');

  openModal('Presupuesto '+presNum(p),
    '<div style="display:flex;gap:8px;margin-bottom:12px">'+
      '<select onchange="cambiarEstadoPres('+p.id+',this.value)" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px">'+
        ['Borrador','Enviado','Aprobado','Rechazado'].map(function(e){return '<option'+(p.estado===e?' selected':'')+'>'+e+'</option>';}).join('')+
      '</select>'+
      '<button class="btn btn-sm btn-p" onclick="generarPDF('+p.id+');cerrarModal()">📄 PDF</button>'+
      '<button class="btn btn-sm" style="color:var(--blue)" onclick="enviarEmailPres('+p.id+');cerrarModal()">📧 Email</button>'+
      aprBtn+
    '</div>'+
    '<div class="fg2">'+
      '<div class="fbox"><div class="fl">Cliente</div><div class="fv">'+p.nombre+'</div></div>'+
      '<div class="fbox"><div class="fl">Teléfono</div><div class="fv">'+p.tel+'</div></div>'+
      '<div class="fbox"><div class="fl">Dirección</div><div class="fv">'+(p.dir||'—')+'</div></div>'+
      '<div class="fbox"><div class="fl">Barrio</div><div class="fv">'+(p.barrio||'—')+'</div></div>'+
      '<div class="fbox"><div class="fl">Línea de producto</div><div class="fv">'+presLineaPill(p)+'</div></div>'+
      '<div class="fbox"><div class="fl">Estado</div><div class="fv">'+presEstadoPill(p.estado)+'</div></div>'+
    '</div>'+
    '<hr class="div">'+
    '<div class="sectitle">Sensores relevados</div>'+
    '<div style="margin-bottom:12px">'+(sensorHtml||'<span style="color:var(--text3)">Sin sensores</span>')+'</div>'+
    '<hr class="div">'+
    '<div class="sectitle">Valor de la cotización</div>'+
    '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);padding:12px;margin-bottom:12px">'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">'+
        '<div>Subtotal: <strong>'+formatMonto(totalConMargen,p.moneda)+'</strong></div>'+
        (descVal>0?'<div style="color:var(--red)">Descuento: <strong>-'+formatMonto(descVal,p.moneda)+'</strong></div>':'<div></div>')+
        '<div style="font-size:15px;font-weight:700">TOTAL: '+formatMonto(totalFinal,p.moneda)+'</div>'+
        '<div style="color:var(--text2)">U$S: '+totalUSD+'</div>'+
      '</div>'+
    '</div>'+
    (p.obsInternas?'<hr class="div"><div class="sectitle">Notas internas</div><p style="font-size:12px;color:var(--text2)">'+p.obsInternas+'</p>':'')
  ,null,true);
}


function generarPDF(id){
  const p=DB.presupuestos.find(function(x){return x.id===id;});
  if(!p)return;

  // Get config
  const cfg = DB.config || {};
  const empresa = cfg.empresa || 'Riego Adaptativo';
  const cfgEmail = cfg.email || '';
  const cfgTel = cfg.tel || '';
  const cfgDireccion = cfg.direccion || '';
  const cfgWeb = cfg.web || '';

  const fecha=new Date().toLocaleDateString('es-AR',{day:'2-digit',month:'long',year:'numeric'});
  const venceDate=new Date(Date.now()+(parseInt(p.validez)||15)*86400000);
  const vence=venceDate.toLocaleDateString('es-AR',{day:'2-digit',month:'long',year:'numeric'});
  const num=presNum(p);

  // Calcular totales
  const sub=calcSubtotales(p);
  const bruto=Object.values(sub).reduce(function(a,v){return a+v;},0);
  const margenVal=bruto*(parseFloat(p.margen)||0)/100;
  const totalConMargen=bruto+margenVal;
  const descVal=parseFloat(p.descuento)||0;
  const totalFinal=totalConMargen-descVal;

  // Ítems presupuestados con cantidad cargada, agrupados por sección (genérico, según línea)
  var linea=getLineaPres(p);
  var itemRows='';
  var seccionesPDF=[];
  (linea&&linea.itemsPresupuesto||[]).forEach(function(it){ if(seccionesPDF.indexOf(it.seccion)===-1) seccionesPDF.push(it.seccion); });
  seccionesPDF.forEach(function(seccion){
    var filasSec='';
    (linea.itemsPresupuesto||[]).filter(function(it){return it.seccion===seccion;}).forEach(function(it){
      var i=p.precios&&p.precios[it.nombre];
      var qty=i?parseFloat(i.cant)||0:0;
      if(qty<=0) return;
      filasSec+='<tr><td>'+it.nombre+'</td><td style="text-align:center">'+qty+'</td></tr>';
    });
    if(filasSec) itemRows+='<tr><td colspan="2" style="background:#f0f0f0;font-weight:700;font-size:10px;text-transform:uppercase">'+seccion+'</td></tr>'+filasSec;
  });

  const descRow=descVal>0?
    '<tr><td colspan="2" style="padding:8px 14px;text-align:right;color:#B71C1C;font-weight:600">Descuento</td>'+
    '<td style="padding:8px 14px;text-align:right;color:#B71C1C;font-weight:600">- '+formatMonto(descVal,p.moneda)+'</td></tr>':'';

  const LOGO=document.getElementById('logo-pdf-data')?document.getElementById('logo-pdf-data').src:'';

  const CSS='*{box-sizing:border-box;margin:0;padding:0}body{font-family:Segoe UI,Arial,sans-serif;color:#222;font-size:12px}'+
    '@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}.no-print{display:none}@page{margin:15mm 12mm}}'+
    '.header{background:#0D1B24;color:#fff;padding:12px 24px;display:flex;align-items:center;gap:14px}'+
    '.header img{width:52px;height:52px;border-radius:50%;border:2px solid #256282}'+
    '.header h1{font-size:16px;font-weight:700}.header p{font-size:10px;color:#aaa;margin-top:1px}'+
    '.hr{margin-left:auto;text-align:right}.pn{font-size:14px;font-weight:700;letter-spacing:.5px}.ps{font-size:10px;color:#aaa;margin-top:2px}'+
    '.body{padding:16px 24px}.section{margin-bottom:14px}'+
    '.st{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#256282;border-bottom:2px solid #256282;padding-bottom:3px;margin-bottom:10px}'+
    '.g2{display:grid;grid-template-columns:1fr 1fr;gap:7px}'+
    '.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px}'+
    '.field{background:#f8f8f8;border-radius:5px;padding:6px 9px}'+
    '.field .fl{font-size:8px;color:#999;font-weight:700;text-transform:uppercase;margin-bottom:1px}'+
    '.field .fv{font-size:12px;font-weight:500}'+
    'table.t{width:100%;border-collapse:collapse}'+
    'table.t th{background:#256282;color:#fff;padding:7px 11px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase}'+
    'table.t td{padding:6px 11px;border-bottom:1px solid #eee;font-size:11px}'+
    'table.t tfoot td{background:#f8f8f8}'+
    '.validez{background:#FFF8E1;border:1px solid #FFD54F;border-radius:5px;padding:7px 11px;margin-bottom:14px;font-size:11px;color:#7B4F00}'+
    '.mb{display:inline-block;background:#E3F2FD;color:#0D47A1;padding:3px 12px;border-radius:20px;font-weight:700;font-size:13px;margin-bottom:5px}'+
    '.mdesc{font-size:11px;color:#555;line-height:1.4}'+
    '.cg{display:grid;grid-template-columns:1fr 1fr;gap:7px}'+
    '.leyenda{padding:8px 24px;background:#f0f0f0;border-top:1px solid #ddd;font-size:9px;color:#888;font-style:italic;line-height:1.4}'+
    '.footer{padding:10px 24px;background:#f5f5f5;border-top:3px solid #256282;display:flex;justify-content:space-between;align-items:center}'+
    '.footer div{font-size:9px;color:#888}'+
    '.btn-print{position:fixed;top:12px;right:12px;background:#256282;color:#fff;border:none;padding:8px 18px;border-radius:7px;font-size:12px;cursor:pointer;font-family:inherit;font-weight:600}';

  const body=
    '<button class="btn-print no-print" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>'+
    '<div class="header">'+
      (LOGO?'<img src="'+LOGO+'" alt="'+empresa+'">':'')+
      '<div><h1>'+empresa.toUpperCase()+'</h1><p>Presupuesto de instalación</p></div>'+
      '<div class="hr"><div class="pn">'+num+'</div><div class="ps">Emitido: '+fecha+'</div></div>'+
    '</div>'+
    '<div class="body">'+
    '<div class="validez">⏱️ <strong>Validez: '+(p.validez||15)+' días corridos</strong> — Vence el '+vence+'</div>'+

    '<div class="section"><div class="st">Datos del cliente</div>'+
      '<div class="g2">'+
        '<div class="field"><div class="fl">Nombre</div><div class="fv">'+p.nombre+'</div></div>'+
        '<div class="field"><div class="fl">Teléfono</div><div class="fv">'+p.tel+'</div></div>'+
        '<div class="field"><div class="fl">Dirección</div><div class="fv">'+p.dir+'</div></div>'+
        '<div class="field"><div class="fl">Barrio</div><div class="fv">'+(p.barrio||'—')+'</div></div>'+
      '</div>'+
    '</div>'+

    '<div class="section"><div class="st">Sistema propuesto</div>'+
      '<div class="mb">'+(linea?linea.nombre:'—')+'</div>'+
      '<div class="mdesc">'+(linea&&linea.descripcion?linea.descripcion:'')+'</div>'+
    '</div>'+

    (itemRows?
    '<div class="section"><div class="st">Equipamiento y materiales</div>'+
      '<table class="t"><thead><tr><th>Ítem</th><th style="text-align:center">Cant.</th></tr></thead>'+
      '<tbody>'+itemRows+'</tbody></table></div>':'')+

    '<div class="section"><div class="st">Condiciones comerciales</div>'+
      '<div class="cg">'+
        '<div class="field"><div class="fl">Plazo de entrega</div><div class="fv">'+(p.plazo||'—')+'</div></div>'+
        '<div class="field"><div class="fl">Forma de pago</div><div class="fv">'+(p.formaPago||'—')+'</div></div>'+
        '<div class="field"><div class="fl">Garantía</div><div class="fv">'+(p.garantia||'—')+'</div></div>'+
        '<div class="field"><div class="fl">Incluye</div><div class="fv">'+(p.incluye||'—')+'</div></div>'+
        (p.noIncluye?'<div class="field" style="grid-column:1/-1"><div class="fl">No incluye</div><div class="fv">'+p.noIncluye+'</div></div>':'')+
      '</div>'+
    '</div>'+

    '<div class="section"><div class="st">Valor de la cotización</div>'+
      '<table class="t">'+
        '<thead><tr><th colspan="2">Descripción</th><th style="text-align:right">Importe</th></tr></thead>'+
        '<tbody>'+
          '<tr><td colspan="2">'+(linea?linea.nombre:'Sistema')+' — instalación y configuración completa</td>'+
            '<td style="text-align:right;font-weight:600">'+formatMonto(totalConMargen,p.moneda)+'</td></tr>'+
          descRow+
        '</tbody>'+
        '<tfoot>'+
          '<tr><td colspan="2" style="padding:9px 11px;font-weight:700;font-size:13px">TOTAL</td>'+
            '<td style="padding:9px 11px;text-align:right;font-weight:700;font-size:16px;color:#256282">'+formatMonto(totalFinal,p.moneda)+'</td></tr>'+
        '</tfoot>'+
      '</table>'+
    '</div>'+
    '</div>'+

    '<div class="leyenda">La presente propuesta es de carácter personal e intransferible, y ha sido elaborada específicamente para el inmueble y las condiciones relevadas. Riego Adaptativo se reserva el derecho de modificar los términos ante variaciones en los requerimientos o condiciones del sitio.</div>'+

    '<div class="footer">'+
      '<div>'+empresa+(cfgTel?' · '+cfgTel:'')+(cfgEmail?' · '+cfgEmail:'')+(cfgDireccion?' · '+cfgDireccion:'')+'</div>'+
      '<div style="text-align:right">'+num+' · Emitido por: '+(p.tecnico||'—')+'<br>Válido '+( p.validez||15)+' días · Vence: '+vence+'</div>'+
    '</div>';

  const w=window.open('','_blank');
  w.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Presupuesto '+num+'</title><style>'+CSS+'</style></head><body>'+body+'</body></html>');
  w.document.close();
}



// STOCK ================================================

let stockSoloCritico = false;

function toggleStockCritico(){
  stockSoloCritico = !stockSoloCritico;
  document.getElementById('btn-critico').style.background = stockSoloCritico ? 'var(--amber-bg)' : '';
  document.getElementById('btn-critico').style.color = stockSoloCritico ? 'var(--amber)' : '';
  renderStock();
}

// stockActual — ver definición en la cabecera del módulo logística

function stockPill(cant, min){
  if(cant<=0) return '<span class="pill p-r">Sin stock</span>';
  if(cant<=min) return '<span class="pill p-a">⚠️ Crítico</span>';
  return '<span class="pill p-g">OK</span>';
}

function fillCatFilter(selId){
  const cats=[...new Set(DB.componentes.map(function(c){return c.categoria;}))].sort();
  const sel=document.getElementById(selId);
  if(!sel) return;
  const cur=sel.value;
  sel.innerHTML='<option value="">Todas las categorías</option>'+cats.map(function(c){return '<option'+(c===cur?' selected':'')+'>'+c+'</option>';}).join('');
}


function pdfStock(){
  const q=(document.getElementById('qs')?document.getElementById('qs').value||'':'').toLowerCase();
  const fa=document.getElementById('fs-area')?document.getElementById('fs-area').value:'';
  const fc=document.getElementById('fs-cat')?document.getElementById('fs-cat').value:'';
  const tc=(DB.config&&DB.config.tipoCambio)||1;
  const empresa=(DB.config&&DB.config.empresa)||'Riego Adaptativo';
  
  var list=DB.componentes.filter(function(c){
    var qty=stockActual(c.id);
    return(!q||(c.desc+c.codigo+(c.categoria||'')).toLowerCase().includes(q))
      &&(!fa||c.area===fa)
      &&(!fc||c.categoria===fc);
  }).sort(function(a,b){var sa=(a.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();var sb=(b.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();return sa.localeCompare(sb,'es');});

  var rows='';
  var totalVal=0;
  list.forEach(function(c){
    var qty=stockActual(c.id);
    var val=qty*(parseFloat(c.precio)||0);
    totalVal+=val;
    var critico=qty<=(parseFloat(c.min)||0);
    rows+='<tr style="'+(critico?'background:#FFF3E0':'')+'">'+
      '<td>'+c.codigo+'</td>'+
      '<td>'+c.desc+'</td>'+
      '<td>'+(c.categoria||'—')+'</td>'+
      '<td>'+(c.area||'—')+'</td>'+
      '<td>'+(c.ubicacion?(c.nroCajon?c.ubicacion+' / '+c.nroCajon:c.ubicacion):(c.nroCajon||'—'))+'</td>'+
      '<td style="text-align:center;font-weight:700;color:'+(critico?'#B71C1C':'#222')+'">'+qty+' '+(c.unidad||'')+'</td>'+
      '<td style="text-align:center">'+(c.min||0)+'</td>'+
      '<td style="text-align:right">$'+Math.round(parseFloat(c.precio)||0).toLocaleString('es-AR')+'</td>'+
      '<td style="text-align:right">$'+Math.round(val).toLocaleString('es-AR')+'</td>'+
    '</tr>';
  });

  var css='*{box-sizing:border-box;margin:0;padding:0}body{font-family:Segoe UI,Arial,sans-serif;padding:20px;font-size:11px}'+
    'h1{font-size:16px;font-weight:700;color:#256282;margin-bottom:2px}'+
    '.meta{font-size:11px;color:#666;margin-bottom:14px}'+
    'table{width:100%;border-collapse:collapse}'+
    'th{background:#256282;color:#fff;padding:6px 8px;text-align:left;font-size:10px}'+
    'td{padding:5px 8px;border-bottom:1px solid #eee}'+
    'tfoot td{background:#f5f5f5;font-weight:700}'+
    '.btn-print{position:fixed;top:12px;right:12px;background:#256282;color:#fff;border:none;padding:7px 16px;border-radius:6px;cursor:pointer;font-size:11px}'+
    '@media print{.btn-print{display:none}}';

  var w=window.open('','_blank');
  w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Stock — '+empresa+'</title><style>'+css+'</style></head><body>'+
    '<button class="btn-print" onclick="window.print()">🖨️ Imprimir</button>'+
    '<h1>INVENTARIO DE STOCK</h1>'+
    '<div class="meta">'+empresa+' · Generado: '+today()+(fa?' · Área: '+fa:'')+(fc?' · Categoría: '+fc:'')+'</div>'+
    '<table><thead><tr><th>Código</th><th>Descripción</th><th>Categoría</th><th>Área</th><th>Ubicación</th><th style="text-align:center">Stock</th><th style="text-align:center">Mín.</th><th style="text-align:right">Precio</th><th style="text-align:right">Valor</th></tr></thead>'+
    '<tbody>'+rows+'</tbody>'+
    '<tfoot><tr><td colspan="8" style="text-align:right;padding:7px 8px">VALOR TOTAL</td>'+
    '<td style="text-align:right;padding:7px 8px;color:#256282">$'+Math.round(totalVal).toLocaleString('es-AR')+'</td></tr>'+
    (tc>1?'<tr><td colspan="8" style="text-align:right;padding:5px 8px;color:#666">Equivalente U$S</td><td style="text-align:right;padding:5px 8px;color:#666">U$S '+(totalVal/tc).toFixed(0)+'</td></tr>':'')+
    '</tfoot></table></body></html>');
  w.document.close();
}

var _stockSort = {col:'desc', dir:1};

function sortStock(col){
  if(_stockSort.col===col) _stockSort.dir*=-1;
  else { _stockSort.col=col; _stockSort.dir=1; }
  renderStock();
}

function renderStock(){
  var tc=parseFloat((DB.config&&DB.config.tipoCambio)||1);
  fillCatFilter('stock-cat-filter');
  const fcat=document.getElementById('stock-cat-filter').value;
  const farea=document.getElementById('stock-area-filter')?document.getElementById('stock-area-filter').value:'';
  const qs=(document.getElementById('q-stock')?document.getElementById('q-stock').value||'':'').toLowerCase();
  let list=DB.componentes.filter(function(c){
    return (!fcat||c.categoria===fcat) &&
           (!farea||c.area===farea||c.area==='Ambas') &&
           (!qs||(c.codigo+c.desc+(c.ubicacion||'')+(c.proveedor||'')).toLowerCase().includes(qs));
  });
  if(stockSoloCritico) list=list.filter(function(c){return stockActual(c.id)<=(parseFloat(c.min)||0);});

  // Sort
  list.sort(function(a,b){
    var va='', vb='';
    if(_stockSort.col==='desc'){va=a.desc||'';vb=b.desc||'';}
    else if(_stockSort.col==='codigo'){va=a.codigo||'';vb=b.codigo||'';}
    else if(_stockSort.col==='categoria'){va=a.categoria||'';vb=b.categoria||'';}
    else if(_stockSort.col==='area'){va=a.area||'';vb=b.area||'';}
    else if(_stockSort.col==='ubicacion'){va=a.ubicacion||'';vb=b.ubicacion||'';}
    else if(_stockSort.col==='cant'){va=stockActual(a.id);vb=stockActual(b.id);return _stockSort.dir*(va-vb);}
    return _stockSort.dir*va.localeCompare(vb);
  });

  const total=DB.componentes.length;
  const criticos=DB.componentes.filter(function(c){return stockActual(c.id)<=(parseFloat(c.min)||0)&&stockActual(c.id)>=0;}).length;
  const sinStock=DB.componentes.filter(function(c){return stockActual(c.id)<=0;}).length;
  var tc=parseFloat((DB.config&&DB.config.tipoCambio)||1);
  var valorTotal=DB.componentes.reduce(function(a,c){return a+stockActual(c.id)*(parseFloat(c.costo)||0);},0);
  var valorTotalUSD=DB.componentes.reduce(function(a,c){
    var cu=parseFloat(c.costo_usd||c.costoUSD)||(tc>1?(parseFloat(c.costo)||0)/tc:0);
    return a+stockActual(c.id)*cu;
  },0);

  document.getElementById('stock-stats').innerHTML=
    '<div class="stat"><div class="stat-n">'+(total)+'</div><div class="stat-l">Componentes</div></div>'+
    '<div class="stat"><div class="stat-n red">'+sinStock+'</div><div class="stat-l">Sin stock</div></div>'+
    '<div class="stat"><div class="stat-n amber">'+criticos+'</div><div class="stat-l">Stock crítico</div></div>'+
    '<div class="stat"><div class="stat-n blue">$'+Math.round(valorTotal).toLocaleString('es-AR')+'</div><div class="stat-l">Valor inventario $</div></div>'+
    '<div class="stat"><div class="stat-n blue">U$S '+Math.round(valorTotalUSD).toLocaleString('es-AR')+'</div><div class="stat-l">Valor inventario U$S</div></div>';

  const tb=document.getElementById('tbody-stock');
  if(!list.length){tb.innerHTML='<tr><td colspan="12" class="empty">Sin componentes. Cargalos desde Catálogo.</td></tr>';return;}
  tb.innerHTML=list.map(function(c){
    const cant=stockActual(c.id);
    var eMat=c.estadoMat==='R'?'<span class="pill p-a" title="Recuperado">R</span>':'<span class="pill p-g" title="Nuevo">N</span>';
    return '<tr>'+
      '<td style="font-family:monospace;font-size:11px">'+c.codigo+'</td>'+
      '<td><strong>'+c.desc+'</strong></td>'+
      '<td>'+c.categoria+'</td>'+
      '<td style="font-weight:700;font-size:13px;color:'+(cant<=0?'var(--red)':cant<=(parseFloat(c.min)||0)?'var(--amber)':'var(--green)')+'">'+cant+' '+c.unidad+'</td>'+
      '<td>'+(c.min||0)+' '+c.unidad+'</td>'+
      '<td>'+(c.ubicacion?(c.nroCajon?c.ubicacion+' / '+c.nroCajon:c.ubicacion):(c.nroCajon||'—'))+'</td>'+
      '<td>'+(c.proveedor||'—')+'</td>'+
      '<td>'+(c.area||'—')+'</td>'+
      '<td style="text-align:center">'+eMat+'</td>'+
      '<td style="text-align:right;font-size:11px">'+(c.costo?'$'+Math.round(parseFloat(c.costo)).toLocaleString('es-AR'):'—')+'</td>'+
      '<td style="text-align:right;font-size:11px">'+((c.costo_usd||c.costoUSD)?'U$S '+parseFloat(c.costo_usd||c.costoUSD).toFixed(1):(c.costo&&tc>1?'U$S '+Math.round(parseFloat(c.costo)/tc):'—'))+'</td>'+
      '<td></td>'+
    '</tr>';
  }).join('');

  // Update sort indicators
  var scols = {codigo:'Código',desc:'Descripción',categoria:'Categoría',cant:'Cantidad',area:'Área',ubicacion:'Cajonera / Cajón'};
  Object.keys(scols).forEach(function(col){
    var th = document.getElementById('sth-'+col);
    if(!th) return;
    th.innerHTML = scols[col] + (col===_stockSort.col?(_stockSort.dir===1?' ▲':' ▼'):'');
  });
}

// CAT=LOGO ============================================
var _catSort = {col:'codigo', dir:1};

function fillProvFilter(){
  var sel = document.getElementById('cat-prov-filter');
  if(!sel) return;
  var cur = sel.value;
  var provs = [...new Set(DB.componentes.map(function(c){return (c.proveedor||'').trim();}).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Todos los proveedores</option>'+
    provs.map(function(p){return '<option value="'+p+'"'+(p===cur?' selected':'')+'>'+p+'</option>';}).join('');
}

function renderCatalogo(){
  fillCatFilter('cat-filter');
  fillProvFilter();
  const q=(document.getElementById('q-cat').value||'').toLowerCase();
  const fc=document.getElementById('cat-filter').value;
  var fprov=document.getElementById('cat-prov-filter')?document.getElementById('cat-prov-filter').value:'';
  var list=DB.componentes.filter(function(c){
    return(!q||(c.codigo+c.desc+(c.proveedor||'')+(c.ubicacion||'')+( c.categoria||'')).toLowerCase().includes(q))
      &&(!fc||c.categoria===fc)
      &&(!fprov||(c.proveedor||'').trim()===fprov);
  });

  // Sort
  list.sort(function(a,b){
    var va='', vb='';
    if(_catSort.col==='desc'){va=a.desc||'';vb=b.desc||'';}
    else if(_catSort.col==='codigo'){va=a.codigo||'';vb=b.codigo||'';}
    else if(_catSort.col==='categoria'){va=a.categoria||'';vb=b.categoria||'';}
    else if(_catSort.col==='area'){va=a.area||'';vb=b.area||'';}
    else if(_catSort.col==='ubicacion'){va=a.ubicacion||'';vb=b.ubicacion||'';}
    else if(_catSort.col==='stock'){va=stockActual(a.id);vb=stockActual(b.id);return _catSort.dir*(va-vb);}
    return _catSort.dir*va.localeCompare(vb);
  });

  const tb=document.getElementById('tbody-cat');
  var catCount=document.getElementById('cat-count');
  if(catCount){
    var total=DB.componentes.length;
    catCount.textContent=list.length===total?total+' ítems':list.length+' de '+total+' ítems';
  }
  if(!list.length){tb.innerHTML='<tr><td colspan="11" class="empty">Sin componentes registrados.</td></tr>';return;}

  tb.innerHTML=list.map(function(c){
    var qty=stockActual(c.id);
    var min=parseFloat(c.min)||0;
    var stockColor=qty<=0?'var(--red)':qty<=min?'#E65100':'var(--green)';
    var stockIcon=qty<=0?'🔴':qty<=min?'🟡':'🟢';
    return '<tr>'+
      '<td style="font-family:monospace;font-size:11px">'+c.codigo+'</td>'+
      '<td>'+c.desc+'</td>'+
      '<td>'+( c.categoria||'—')+'</td>'+
      '<td>'+(c.unidad||'—')+'</td>'+
      '<td>'+(c.min||0)+'</td>'+
      '<td style="font-weight:700;color:'+stockColor+'">'+stockIcon+' '+qty+'</td>'+
      '<td><span class="pill '+(c.area==='Mantenimiento'?'p-b':c.area==='Instalacion'?'p-a':c.area==='Ambas'?'p-p':'p-g')+'">'+(c.area||'Fábrica')+'</span></td>'+
      '<td>'+(c.ubicacion?(c.nroCajon?c.ubicacion+' / '+c.nroCajon:c.ubicacion):(c.nroCajon||'—'))+'</td>'+
      '<td>'+(c.proveedor||'—')+'</td>'+
      '<td style="text-align:center">'+(c.estadoMat==='R'?'<span class="pill p-a" title="Recuperado">R</span>':'<span class="pill p-g" title="Nuevo">N</span>')+'</td>'+
      '<td style="display:flex;gap:3px">'+
        '<button class="btn btn-sm" onclick="modalComponente('+c.id+')" title="Editar">✏️</button>'+
        '<button class="btn btn-sm" onclick="duplicarComponente('+c.id+')" title="Duplicar">📋</button>'+
        '<button class="btn btn-sm" style="color:var(--red)" onclick="eliminarComponente('+c.id+')" title="Eliminar">🗑️</button>'+
      '</td>'+
    '</tr>';
  }).join('');

  // Update sort indicators on headers
  var cols = {codigo:'Código',desc:'Descripción',categoria:'Categoría',stock:'Stock',area:'Área',ubicacion:'Cajonera / Cajón'};
  Object.keys(cols).forEach(function(col){
    var th = document.getElementById('th-'+col);
    if(!th) return;
    th.innerHTML = cols[col] + (col===_catSort.col?(_catSort.dir===1?' ▲':' ▼'):'');
  });
}

function sortCatalogo(col){
  if(_catSort.col===col) _catSort.dir*=-1;
  else { _catSort.col=col; _catSort.dir=1; }
  renderCatalogo();
}

function duplicarComponente(id){
  var c=DB.componentes.find(function(x){return x.id===id;});
  if(!c) return;
  var nuevo=Object.assign({},c,{id:DB.nid++,codigo:c.codigo+'-2',desc:'Copia de '+c.desc});
  DB.componentes.push(nuevo);
  save(); renderCatalogo();
  // Open edit modal for the new component
  modalComponente(nuevo.id);
}

function pdfCatalogo(){
  var empresa=(DB.config&&DB.config.empresa)||'Riego Adaptativo';
  var q=(document.getElementById('q-cat')?document.getElementById('q-cat').value||'':'').toLowerCase();
  var fc=document.getElementById('cat-filter')?document.getElementById('cat-filter').value:'';
  var fprov2=document.getElementById('cat-prov-filter')?document.getElementById('cat-prov-filter').value:'';
  var list=DB.componentes.filter(function(c){
    return(!q||(c.codigo+c.desc+(c.proveedor||'')).toLowerCase().includes(q))
      &&(!fc||c.categoria===fc)
      &&(!fprov2||(c.proveedor||'').trim()===fprov2);
  }).sort(function(a,b){var sa=(a.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();var sb=(b.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();return sa.localeCompare(sb,'es');});

  var rows=list.map(function(c){
    var qty=stockActual(c.id);
    var min=parseFloat(c.min)||0;
    var critico=qty<=min;
    return '<tr style="'+(critico?'background:#FFF3E0':'')+'">'+
      '<td>'+c.codigo+'</td><td>'+c.desc+'</td><td>'+(c.categoria||'—')+'</td>'+
      '<td>'+(c.area||'—')+'</td><td>'+(c.ubicacion||'—')+'</td>'+
      '<td style="text-align:center;font-weight:700;color:'+(critico?'#B71C1C':'#222')+'">'+qty+'</td>'+
      '<td style="text-align:center">'+(c.min||0)+'</td>'+
      '<td>'+(c.proveedor||'—')+'</td>'+
      '<td style="text-align:right">$'+Math.round(parseFloat(c.precio)||0).toLocaleString('es-AR')+'</td>'+
    '</tr>';
  }).join('');

  var css='*{box-sizing:border-box;margin:0;padding:0}body{font-family:Segoe UI,Arial,sans-serif;padding:20px;font-size:11px}'+
    'h1{font-size:15px;color:#256282;margin-bottom:2px}.meta{color:#666;font-size:10px;margin-bottom:12px}'+
    'table{width:100%;border-collapse:collapse}th{background:#256282;color:#fff;padding:6px 8px;font-size:10px;text-align:left}'+
    'td{padding:5px 8px;border-bottom:1px solid #eee}'+
    '.btn{position:fixed;top:12px;right:12px;background:#256282;color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer}'+
    '@media print{.btn{display:none}}';

  var w=window.open('','_blank');
  w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Catálogo</title><style>'+css+'</style></head><body>'+
    '<button class="btn" onclick="window.print()">🖨️ Imprimir</button>'+
    '<h1>CATÁLOGO DE COMPONENTES</h1>'+
    '<div class="meta">'+empresa+' · '+today()+'</div>'+
    '<table><thead><tr><th>Código</th><th>Descripción</th><th>Categoría</th><th>Área</th><th>Ubicación</th>'+
    '<th style="text-align:center">Stock</th><th style="text-align:center">Mín.</th><th>Proveedor</th><th style="text-align:right">Precio</th></tr></thead>'+
    '<tbody>'+rows+'</tbody></table></body></html>');
  w.document.close();
}


function getUbicDatalist(){
  var ubicaciones = DB.componentes
    .map(function(c){ return c.ubicacion; })
    .filter(function(u){ return u && u.length > 0; });
  ubicaciones = [...new Set(ubicaciones)].sort();
  var opts = ubicaciones.map(function(u){
    return '<option value="'+u+'"></option>';
  }).join('');
  return '<datalist id="dl-cp-ubic">'+opts+'</datalist>';
}


function calcPreciosComp(){
  var tc=(DB.config&&DB.config.tipoCambio)||1;
  var v=parseFloat(document.getElementById('cp-costo').value)||0;
  var el=document.getElementById('cp-costo-usd');
  if(el&&tc>0) el.value=(v/tc).toFixed(2);
}
function calcPreciosCompUSD(){
  var tc=(DB.config&&DB.config.tipoCambio)||1;
  var v=parseFloat(document.getElementById('cp-costo-usd').value)||0;
  var el=document.getElementById('cp-costo');
  if(el) el.value=Math.round(v*tc);
}
function calcPreciosVentaComp(){
  var tc=(DB.config&&DB.config.tipoCambio)||1;
  var v=parseFloat(document.getElementById('cp-venta').value)||0;
  var el=document.getElementById('cp-venta-usd');
  if(el&&tc>0) el.value=(v/tc).toFixed(2);
}
function calcPreciosVentaCompUSD(){
  var tc=(DB.config&&DB.config.tipoCambio)||1;
  var v=parseFloat(document.getElementById('cp-venta-usd').value)||0;
  var el=document.getElementById('cp-venta');
  if(el) el.value=Math.round(v*tc);
}

function modalComponente(id){
  const c=id>=0?DB.componentes.find(function(x){return x.id===id;}):null;
  const cats=[...new Set(DB.componentes.map(function(x){return x.categoria;}))].filter(Boolean);
  const catOpts=cats.map(function(x){return '<option'+(c&&c.categoria===x?' selected':'')+'>'+x+'</option>';}).join('');
  openModal(c?'Editar componente':'Nuevo componente',
    '<div class="fg2">'+
      '<div class="fg"><label>Código *</label><input id="cp-cod" value="'+(c?c.codigo:'')+'" placeholder="Ej: ESP32-D0WD"></div>'+
      '<div class="fg"><label>Descripción *</label><input id="cp-desc" value="'+(c?c.desc:'')+'" placeholder="Ej: Módulo ESP32 D0WD-V3"></div>'+
      '<div class="fg"><label>EAN</label><input id="cp-ean" value="'+(c?c.ean||'':'')+'" placeholder="Código de barras (opcional)"></div>'+
      '<div class="fg"><label>Categoría *</label>'+
        '<input id="cp-cat" value="'+(c?c.categoria:'')+'" placeholder="Ej: Electrónica" list="cats-list">'+
        '<datalist id="cats-list">'+catOpts+'</datalist></div>'+
      '<div class="fg"><label>Unidad</label><select id="cp-uni" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px">'+
        ['u','m','ml','kg','g','par','juego'].map(function(u){return '<option'+(c&&c.unidad===u?' selected':'')+'>'+u+'</option>';}).join('')+
      '</select></div>'+
      '<div class="fg"><label>Stock mínimo</label><input id="cp-min" type="number" min="0" value="'+(c?c.min||0:0)+'"></div>'+
      '<div class="fg full" style="grid-column:1/-1"><hr style="border:none;border-top:1px solid var(--border);margin:4px 0"></div>'+
      '<div class="fg full"><div class="sectitle" style="margin:0 0 6px">Precios</div></div>'+
      '<div class="fg"><label>Costo ($)</label><input id="cp-costo" type="number" min="0" value="'+(c?c.costo||c.precio||0:0)+'" oninput="calcPreciosComp()"></div>'+
      '<div class="fg"><label>Costo (U$S)</label><input id="cp-costo-usd" type="number" min="0" step="0.01" value="'+(c&&(DB.config&&DB.config.tipoCambio)?((c.costo||c.precio||0)/(DB.config.tipoCambio||1)).toFixed(2):0)+'" oninput="calcPreciosCompUSD()"></div>'+
      '<div class="fg"><label>Venta ($)</label><input id="cp-venta" type="number" min="0" value="'+(c?c.venta||0:0)+'" oninput="calcPreciosVentaComp()"></div>'+
      '<div class="fg"><label>Venta (U$S)</label><input id="cp-venta-usd" type="number" min="0" step="0.01" value="'+(c&&(DB.config&&DB.config.tipoCambio)?((c.venta||0)/(DB.config.tipoCambio||1)).toFixed(2):0)+'" oninput="calcPreciosVentaCompUSD()"></div>'+
      '<div class="fg"><label>Proveedor</label><input id="cp-prov" value="'+(c?c.proveedor||'':'')+'" placeholder="Nombre del proveedor" list="dl-cp-prov">'+
      '<datalist id="dl-cp-prov">'+([...DB.proveedores].sort(function(a,b){return (a.empresa||'').localeCompare(b.empresa||'');}).map(function(p){return '<option value="'+p.empresa+'">'+p.empresa+'</option>';}).join(''))+'</datalist></div>'+
      '<div class="fg"><label>Área *</label>'+
        '<select id="cp-area" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
          ['Fábrica','Mantenimiento','Instalacion'].map(function(a){return '<option'+(c&&c.area===a?' selected':'')+'>'+a+'</option>';}).join('')+
        '</select></div>'+
      '<div class="fg"><label>Cajonera</label><input id="cp-ubic" value="'+(c?c.ubicacion||'':'')+'" placeholder="Ej: Cajonera A" list="dl-cp-ubic">'+
      '<datalist id="dl-cp-ubic">'+(function(){var u=[...new Set(DB.componentes.filter(function(x){return x.ubicacion;}).map(function(x){return x.ubicacion;}))];return u.map(function(u){return '<option value="'+u+'">'+u+'</option>';}).join('');})()+'</datalist></div>'+
      '<div class="fg"><label>Nro Cajón</label><input id="cp-nrocajon" value="'+(c?c.nroCajon||'':'')+'" placeholder="Ej: 3"></div>'+
      '<div class="fg"><label>Estado material</label>'+
        '<select id="cp-emat" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
          '<option value="N"'+(c&&c.estadoMat==='N'?' selected':(!c?' selected':''))+'>N — Nuevo</option>'+
          '<option value="R"'+(c&&c.estadoMat==='R'?' selected':'')+'>R — Recuperado</option>'+
        '</select></div>'+
      '<div class="fg full" style="grid-column:1/-1"><label>Notas</label>'+
        '<textarea id="cp-notas" rows="3" placeholder="Observaciones, compatibilidad, instrucciones de uso..." style="width:100%;padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;resize:vertical;font-family:inherit;box-sizing:border-box">'+(c?c.notas||'':'')+'</textarea></div>'+
      (!c?'<div class="fg full" style="grid-column:1/-1"><hr style="border:none;border-top:1px solid var(--border);margin:4px 0"></div>'+
        '<div class="fg full"><div class="sectitle" style="margin:0 0 6px">Stock inicial</div></div>'+
        '<div class="fg"><label>Cantidad</label><input id="cp-stock-ini" type="number" min="0" value="0"></div>'+
        '<div class="fg"><label>Motivo</label><input id="cp-stock-mot" value="Stock inicial" placeholder="Ej: Stock inicial, compra, etc."></div>':'')+
    '</div>',
    function(){
      const cod=document.getElementById('cp-cod').value.trim();
      const desc=document.getElementById('cp-desc').value.trim();
      const cat=document.getElementById('cp-cat').value.trim();
      if(!cod||!desc||!cat){alert('Código, descripción y categoría son obligatorios.');return false;}
      if(c){
        c.codigo=cod;c.desc=desc;c.categoria=cat;
        c.ean=document.getElementById('cp-ean').value.trim();
        c.unidad=document.getElementById('cp-uni').value;
        c.min=parseFloat(document.getElementById('cp-min').value)||0;
        c.costo=parseFloat(document.getElementById('cp-costo').value)||0;
        c.precio=c.costo; // backward compat
        c.costo_usd=parseFloat(document.getElementById('cp-costo-usd').value)||0;
        c.venta=parseFloat(document.getElementById('cp-venta').value)||0;
        c.venta_usd=parseFloat(document.getElementById('cp-venta-usd').value)||0;
        c.area=document.getElementById('cp-area')?document.getElementById('cp-area').value:'Fábrica';
        c.proveedor=document.getElementById('cp-prov').value;
        c.ubicacion=document.getElementById('cp-ubic').value;
        c.nroCajon=document.getElementById('cp-nrocajon')?document.getElementById('cp-nrocajon').value:'';
        c.estadoMat=document.getElementById('cp-emat')?document.getElementById('cp-emat').value:'N';
        c.notas=document.getElementById('cp-notas')?document.getElementById('cp-notas').value.trim():'';
      } else {
        var newCosto=parseFloat(document.getElementById('cp-costo')?document.getElementById('cp-costo').value:0)||0;
        var newId=DB.nid++;
        DB.componentes.push({
          id:newId,codigo:cod,desc:desc,categoria:cat,
          ean:document.getElementById('cp-ean')?document.getElementById('cp-ean').value.trim():'',
          unidad:document.getElementById('cp-uni')?document.getElementById('cp-uni').value:'',
          min:parseFloat(document.getElementById('cp-min')?document.getElementById('cp-min').value:0)||0,
          precio:newCosto,
          costo:newCosto,
          costo_usd:parseFloat(document.getElementById('cp-costo-usd')?document.getElementById('cp-costo-usd').value:0)||0,
          venta:parseFloat(document.getElementById('cp-venta')?document.getElementById('cp-venta').value:0)||0,
          venta_usd:parseFloat(document.getElementById('cp-venta-usd')?document.getElementById('cp-venta-usd').value:0)||0,
          area:document.getElementById('cp-area')?document.getElementById('cp-area').value:'Fábrica',
          proveedor:document.getElementById('cp-prov')?document.getElementById('cp-prov').value:'',
          ubicacion:document.getElementById('cp-ubic')?document.getElementById('cp-ubic').value:'',
          nroCajon:document.getElementById('cp-nrocajon')?document.getElementById('cp-nrocajon').value:'',
          estadoMat:document.getElementById('cp-emat')?document.getElementById('cp-emat').value:'N',
          notas:document.getElementById('cp-notas')?document.getElementById('cp-notas').value.trim():''
        });
        var stockIni=parseFloat(document.getElementById('cp-stock-ini')?document.getElementById('cp-stock-ini').value:0)||0;
        if(stockIni>0){
          var motIni=(document.getElementById('cp-stock-mot')?document.getElementById('cp-stock-mot').value:'Stock inicial').trim()||'Stock inicial';
          DB.movimientos.push({id:DB.nid++,cid:newId,tipo:'Entrada',cant:stockIni,fecha:today(),ref:'',lote:'',precio:newCosto,nota:motIni});
        }
      }
      save();renderCatalogo();return true;
    });
}

function eliminarComponente(id){
  if(!confirm('¿Eliminar este componente? Se perderán sus movimientos.'))return;
  DB.componentes=DB.componentes.filter(function(x){return x.id!==id;});
  DB.movimientos=DB.movimientos.filter(function(x){return x.cid!==id;});
  save();renderCatalogo();
}

// MOVIMIENTOS =========================================
function movTipoPill(t){
  const mp={'Entrada':'p-g','Salida manual':'p-r','Salida instalación':'p-b'};
  return '<span class="pill '+(mp[t]||'p-x')+'">'+t+'</span>';
}

function renderMovimientos(){
  const q=(document.getElementById('q-mov').value||'').toLowerCase();
  const ft=document.getElementById('mov-tipo-filter').value;
  const fm=document.getElementById('mov-motivo-filter')?document.getElementById('mov-motivo-filter').value:'';
  const fo=document.getElementById('mov-origen-filter')?document.getElementById('mov-origen-filter').value:'';
  // Poblar select de motivos con valores únicos del historial
  var selMot=document.getElementById('mov-motivo-filter');
  if(selMot){
    var motivosUsados=[...new Set(DB.movimientos.filter(function(m){return m.tipo==='Salida manual'&&m.nota;}).map(function(m){return m.nota.trim();}))].sort();
    var curVal=selMot.value;
    selMot.innerHTML='<option value="">Todos los motivos</option>'+motivosUsados.map(function(mot){return '<option value="'+mot+'"'+(mot===curVal?' selected':'')+'>'+mot+'</option>';}).join('');
  }
  // Poblar select de orígenes con valores únicos del historial
  var selOri=document.getElementById('mov-origen-filter');
  if(selOri){
    var origenesUsados=[...new Set(DB.movimientos.filter(function(m){return m.tipo==='Entrada'&&m.origen;}).map(function(m){return m.origen.trim();}))].sort();
    var curOri=selOri.value;
    selOri.innerHTML='<option value="">Todos los orígenes</option>'+origenesUsados.map(function(ori){return '<option value="'+ori+'"'+(ori===curOri?' selected':'')+'>'+ori+'</option>';}).join('');
  }
  const list=DB.movimientos.filter(function(m){
    const comp=DB.componentes.find(function(c){return c.id===(m.cid||m.compId);})||{desc:'—',codigo:'',unidad:''};
    var matchQ=!q||(comp.desc+comp.codigo+(m.ref||'')+(m.nota||'')+(m.origen||'')).toLowerCase().includes(q);
    var matchT=!ft||m.tipo===ft;
    var matchM=!fm||(m.nota||'').trim()===fm;
    var matchO=!fo||(m.origen||'').trim()===fo;
    return matchQ&&matchT&&matchM&&matchO;
  }).sort(function(a,b){
    var ca=DB.componentes.find(function(c){return c.id===(a.cid||a.compId);})||{};
    var cb=DB.componentes.find(function(c){return c.id===(b.cid||b.compId);})||{};
    var sa=(ca.codigo||'').toLowerCase(); var sb=(cb.codigo||'').toLowerCase();
    if(sa!==sb) return sa.localeCompare(sb);
    return b.fecha.localeCompare(a.fecha);
  });

  const tb=document.getElementById('tbody-mov');
  if(!list.length){tb.innerHTML='<tr><td colspan="11" class="empty">Sin movimientos registrados.</td></tr>';return;}
  const tc=(DB.config&&DB.config.tipoCambio)||1;
  tb.innerHTML=list.map(function(m){
    const comp=DB.componentes.find(function(c){return c.id===(m.cid||m.compId);})||{desc:'—',codigo:'—',unidad:''};
    const cli=m.clienteId?DB.clientes.find(function(c){return c.id===m.clienteId;}):null;
    const precioUSD=m.precio&&tc>0?'U$S '+(parseFloat(m.precio)/tc).toFixed(2):'—';
    var eMat=m.estadoMat==='R'?'<span class="pill p-a" title="Recuperado">R</span>':'<span class="pill p-g" title="Nuevo">N</span>';
    return '<tr>'+
      '<td>'+m.fecha+'</td>'+
      '<td>'+movTipoPill(m.tipo)+'</td>'+
      '<td style="font-family:monospace;font-size:11px">'+comp.codigo+'</td>'+
      '<td>'+comp.desc+'</td>'+
      '<td style="font-weight:600">'+(m.tipo==='Entrada'?'+':'-')+(m.cant||0)+' '+comp.unidad+'</td>'+
      '<td style="text-align:center">'+eMat+'</td>'+
      '<td>'+(m.precio?'$'+parseFloat(m.precio).toLocaleString('es-AR'):'—')+'</td>'+
      '<td>'+precioUSD+'</td>'+
      '<td>'+(m.ref||'—')+'</td>'+
      '<td>'+(cli?cli.nombre:(m.nota||'—'))+'</td>'+
      '<td style="font-size:11px">'+(m.origen||'—')+'</td>'+
      '<td style="display:flex;gap:3px"><button class="btn btn-sm" onclick="editarMovimiento('+m.id+')">✏️</button>'+
      '<button class="btn btn-sm" style="color:var(--red)" onclick="borrarMovimiento('+m.id+')">🗑️</button></td>'+
    '</tr>';
  }).join('');
}


function mostrarPrecioComp(){
  var el = document.getElementById('mv-precio-display');
  if(!el) return;
  var cid = parseInt(document.getElementById('mv-cid').value)||0;
  if(!cid){ el.textContent='— seleccionar componente —'; return; }
  var comp = DB.componentes.find(function(c){return c.id===cid;});
  if(!comp){ el.textContent='—'; return; }
  var tc = parseFloat((DB.config&&DB.config.tipoCambio)||1);
  var pesos = comp.costo ? '$'+Math.round(parseFloat(comp.costo)).toLocaleString('es-AR') : '—';
  var usd = (comp.costo_usd||comp.costoUSD) ? 'U$S '+parseFloat(comp.costo_usd||comp.costoUSD).toFixed(2) :
            (comp.costo&&tc>1 ? 'U$S '+Math.round(parseFloat(comp.costo)/tc) : '—');
  el.textContent = pesos + ' / ' + usd;
  el.style.color = 'var(--text)';
  el.style.fontWeight = '600';
}

function modalMovimiento(tipo, preselCid){
  const compOpts=[...DB.componentes].sort(function(a,b){var sa=(a.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();var sb=(b.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();return sa.localeCompare(sb,'es');}).map(function(c){
    return '<option value="'+c.id+'"'+(preselCid===c.id?' selected':'')+'>'+c.codigo+' — '+c.desc+'</option>';
  }).join('');
  const cliOpts=DB.clientes.filter(function(c){return c.estado==='Activo';}).map(function(c){
    return '<option value="'+c.id+'">'+c.nombre+' · '+c.lote+'</option>';
  }).join('');
  const esInstalacion=tipo==='Salida instalación';
  openModal(tipo,
    '<div class="fg2">'+
      '<div class="fg"><label>Componente *</label>'+
        '<select id="mv-cid" onchange="mostrarPrecioComp()" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
          '<option value="">-- seleccionar --</option>'+compOpts+
        '</select></div>'+
      '<div class="fg"><label>Cantidad *</label><input id="mv-cant" type="number" min="1" value="1"></div>'+
      '<div class="fg"><label>Fecha</label><input id="mv-fecha" type="date" value="'+today()+'"></div>'+
      (tipo==='Entrada'?
        '<div class="fg"><label>Precio catálogo</label><div id="mv-precio-display" style="padding:6px 9px;font-size:12px;color:var(--text2)">— seleccionar componente —</div></div>'+
        '<div class="fg"><label>Remito / Factura ref.</label><input id="mv-ref" placeholder="Ej: FAC-00123"></div>'+
        '<div class="fg"><label>Lote / N° de serie</label><input id="mv-lote" placeholder="Opcional"></div>'+
        '<div class="fg"><label>Origen *</label>'+
          '<select id="mv-origen-sel" onchange="toggleOrigenOtro()" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
            (DB.config.origenesEntrada||[]).map(function(o){return '<option value="'+o+'">'+o+'</option>';}).join('')+
            '<option value="__otro__">Otro...</option>'+
          '</select></div>'+
        '<div class="fg" id="mv-origen-otro-wrap" style="display:none"><label>Especificar origen</label>'+
          '<input id="mv-origen-otro" placeholder="Describí el origen...">'+
        '</div>'+
        '<div class="fg"><label>Estado material *</label>'+
          '<select id="mv-emat" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
            '<option value="N" selected>N -- Nuevo</option>'+
            '<option value="R">R -- Recuperado</option>'+
          '</select></div>'
      :
        (esInstalacion?
          '<div class="fg"><label>Cliente *</label>'+
            '<select id="mv-cli" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
              '<option value="">-- seleccionar cliente --</option>'+cliOpts+
            '</select></div>'
          :'')+
        '<div class="fg"><label>Ubicación</label><input id="mv-ubic" list="dl-mv-ubic" placeholder="Ej: Estante A">'+stockDatalist("mv-ubic","",'ubicaciones')+'</div>'+
        '<div class="fg"><label>Motivo *</label>'+
          '<select id="mv-motivo-sel" onchange="toggleMotivoOtro()" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
            (DB.config.motivosSalida||[]).map(function(m){return '<option value="'+m+'">'+m+'</option>';}).join('')+
            '<option value="__otro__">Otro...</option>'+
          '</select></div>'+
        '<div class="fg" id="mv-motivo-otro-wrap" style="display:none"><label>Especificar motivo</label>'+
          '<input id="mv-motivo-otro" placeholder="Describí el motivo...">'+
        '</div>'+
        '<div class="fg"><label>Estado material</label>'+
          '<select id="mv-emat" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
            '<option value="N" selected>N -- Nuevo</option>'+
            '<option value="R">R -- Recuperado</option>'+
          '</select></div>'
      )+
    '</div>',
    function(){
      const cid=parseInt(document.getElementById('mv-cid').value);
      const cant=parseFloat(document.getElementById('mv-cant').value)||0;
      if(!cid||cant<=0){alert('Seleccioná un componente e ingresá la cantidad.');return false;}
      const mov={
        id:DB.nid++, cid:cid, tipo:tipo, cant:cant,
        fecha:document.getElementById('mv-fecha').value
      };
      if(tipo==='Entrada'){
        var compCat=DB.componentes.find(function(c){return c.id===parseInt(document.getElementById('mv-cid').value);});
        mov.precio=compCat?parseFloat(compCat.costo)||0:0;
        mov.precioUSD=compCat?parseFloat(compCat.costo_usd||compCat.costoUSD)||0:0;
        mov.ref=document.getElementById('mv-ref').value;
        mov.lote=document.getElementById('mv-lote').value;
        mov.estadoMat=document.getElementById('mv-emat')?document.getElementById('mv-emat').value:'N';
        var origenSel=document.getElementById('mv-origen-sel');
        var origenOtro=document.getElementById('mv-origen-otro');
        var origenVal=origenSel?origenSel.value:'';
        if(origenVal==='__otro__'){
          origenVal=origenOtro?origenOtro.value.trim():'';
          if(origenVal&&DB.config.origenesEntrada&&DB.config.origenesEntrada.indexOf(origenVal)===-1){
            DB.config.origenesEntrada.push(origenVal);
          }
        }
        mov.origen=origenVal;
      } else if(esInstalacion){
        const cliId=parseInt(document.getElementById('mv-cli').value);
        if(!cliId){alert('Seleccioná un cliente.');return false;}
        mov.clienteId=cliId;
        mov.estadoMat=document.getElementById('mv-emat')?document.getElementById('mv-emat').value:'N';
      } else {
        var motivoSel = document.getElementById('mv-motivo-sel');
        var motivoOtro = document.getElementById('mv-motivo-otro');
        var motivoVal = motivoSel ? motivoSel.value : '';
        if(motivoVal === '__otro__'){
          motivoVal = motivoOtro ? motivoOtro.value.trim() : '';
          // Agregar a la lista si no existe
          if(motivoVal && DB.config.motivosSalida && DB.config.motivosSalida.indexOf(motivoVal) === -1){
            DB.config.motivosSalida.push(motivoVal);
          }
        }
        mov.nota = motivoVal;
        mov.estadoMat=document.getElementById('mv-emat')?document.getElementById('mv-emat').value:'N';
      }
      DB.movimientos.push(mov);
      save();renderMovimientos();renderStock();return true;
    });
}

// Toggle campo 'Otro' en modal entrada - origen
function toggleOrigenOtro(){
  var sel=document.getElementById('mv-origen-sel');
  var wrap=document.getElementById('mv-origen-otro-wrap');
  if(!sel||!wrap) return;
  wrap.style.display=sel.value==='__otro__'?'':'none';
  if(sel.value==='__otro__'){var inp=document.getElementById('mv-origen-otro');if(inp)inp.focus();}
}

// Toggle campo 'Otro' en modal salida manual
function toggleMotivoOtro(){
  var sel = document.getElementById('mv-motivo-sel');
  var wrap = document.getElementById('mv-motivo-otro-wrap');
  if(!sel || !wrap) return;
  wrap.style.display = sel.value === '__otro__' ? '' : 'none';
  if(sel.value === '__otro__'){
    var inp = document.getElementById('mv-motivo-otro');
    if(inp) inp.focus();
  }
}

// REPORTE: Entradas por origen ================================
function reporteEntradasPorOrigen(){
  var hoy = today();
  var primerMes = hoy.slice(0,7)+'-01';

  var fDesde  = document.getElementById('reo-desde')  ? document.getElementById('reo-desde').value  : primerMes;
  var fHasta  = document.getElementById('reo-hasta')  ? document.getElementById('reo-hasta').value  : hoy;
  var fComp   = document.getElementById('reo-comp')   ? document.getElementById('reo-comp').value.toLowerCase()   : '';
  var fOrigen = document.getElementById('reo-origen') ? document.getElementById('reo-origen').value : '';

  var entradas = DB.movimientos.filter(function(m){
    if(m.tipo !== 'Entrada') return false;
    if(fDesde && m.fecha < fDesde) return false;
    if(fHasta && m.fecha > fHasta) return false;
    if(fComp){
      var comp = DB.componentes.find(function(c){return c.id===(m.cid||m.compId);});
      if(!comp || !(comp.desc+comp.codigo).toLowerCase().includes(fComp)) return false;
    }
    if(fOrigen && (m.origen||'Sin origen').trim() !== fOrigen) return false;
    return true;
  });

  // Agrupar por origen
  var grupos = {};
  entradas.forEach(function(m){
    var ori = (m.origen||'Sin origen').trim() || 'Sin origen';
    if(!grupos[ori]) grupos[ori] = {movimientos:[], totalCant:0, totalValor:0};
    var comp = DB.componentes.find(function(c){return c.id===(m.cid||m.compId);})||{};
    var valor = (parseFloat(m.cant)||0) * (parseFloat(comp.costo||comp.precio)||0);
    grupos[ori].movimientos.push({m:m, comp:comp, valor:valor});
    grupos[ori].totalCant += parseFloat(m.cant)||0;
    grupos[ori].totalValor += valor;
  });

  var origenesOrdenados = Object.keys(grupos).sort(function(a,b){
    return grupos[b].totalValor - grupos[a].totalValor;
  });

  var tc = (DB.config&&DB.config.tipoCambio)||1;

  // Orígenes disponibles para el select
  var origenesDisp = [...new Set(DB.movimientos.filter(function(m){return m.tipo==='Entrada';}).map(function(m){return (m.origen||'Sin origen').trim();}))].sort();

  var h = '<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px">'+
    '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Desde</label>'+
      '<input id="reo-desde" type="date" value="'+fDesde+'" onchange="reporteEntradasPorOrigen()" '+
      'style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)"></div>'+
    '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Hasta</label>'+
      '<input id="reo-hasta" type="date" value="'+fHasta+'" onchange="reporteEntradasPorOrigen()" '+
      'style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)"></div>'+
    '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Componente</label>'+
      '<input id="reo-comp" value="'+(fComp||'')+'" placeholder="Filtrar por componente..." onchange="reporteEntradasPorOrigen()" '+
      'style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)"></div>'+
    '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Origen</label>'+
      '<select id="reo-origen" onchange="reporteEntradasPorOrigen()" style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)">'+
        '<option value="">Todos los orígenes</option>'+
        origenesDisp.map(function(o){return '<option value="'+o+'"'+(o===fOrigen?' selected':'')+'>'+o+'</option>';}).join('')+
      '</select></div>'+
    '<button class="btn btn-sm" onclick="limpiarFiltrosREO()">✕ Limpiar</button>'+
  '</div>';

  if(!entradas.length){
    h += '<div class="empty">Sin entradas en el período seleccionado.</div>';
    reporteContainer('📥 Entradas por origen', h);
    return;
  }

  var totalMov = entradas.length;
  var totalValor = entradas.reduce(function(a,m){
    var comp = DB.componentes.find(function(c){return c.id===(m.cid||m.compId);})||{};
    return a + (parseFloat(m.cant)||0)*(parseFloat(comp.costo||comp.precio)||0);
  },0);

  h += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">'+
    '<div class="stat"><div class="stat-n">'+totalMov+'</div><div class="stat-l">Movimientos</div></div>'+
    '<div class="stat"><div class="stat-n">'+origenesOrdenados.length+'</div><div class="stat-l">Orígenes distintos</div></div>'+
    '<div class="stat"><div class="stat-n green">$'+Math.round(totalValor).toLocaleString('es-AR')+'</div><div class="stat-l">Valor total</div></div>'+
  '</div>';

  origenesOrdenados.forEach(function(ori){
    var g = grupos[ori];
    var pct = totalValor > 0 ? Math.round(g.totalValor/totalValor*100) : 0;

    h += '<div class="card" style="margin-bottom:10px">'+
      '<div class="ch">'+
        '<div class="ct">'+ori+'</div>'+
        '<div style="display:flex;gap:10px;align-items:center;font-size:12px">'+
          '<span style="color:var(--text2)">'+g.movimientos.length+' mov.</span>'+
          '<span style="font-weight:700;color:var(--green)">$'+Math.round(g.totalValor).toLocaleString('es-AR')+'</span>'+
          (tc>1?'<span style="color:var(--text2);font-size:11px">U$S '+(g.totalValor/tc).toFixed(0)+'</span>':'')+
          '<span style="color:var(--text2);font-size:11px">'+pct+'% del total</span>'+
        '</div>'+
      '</div>'+
      '<div class="card-body">'+
      '<div style="background:var(--surface2);border-radius:3px;height:4px;margin-bottom:10px;overflow:hidden">'+
        '<div style="height:100%;background:var(--green);width:'+pct+'%"></div>'+
      '</div>'+
      '<table style="width:100%;border-collapse:collapse">'+
      '<thead><tr style="background:var(--surface2)">'+
        '<th style="padding:5px 10px;font-size:10px;text-align:left">Fecha</th>'+
        '<th style="padding:5px 10px;font-size:10px;text-align:left">Código</th>'+
        '<th style="padding:5px 10px;font-size:10px;text-align:left">Componente</th>'+
        '<th style="padding:5px 10px;font-size:10px;text-align:center">Cant.</th>'+
        '<th style="padding:5px 10px;font-size:10px;text-align:right">Precio unit.</th>'+
        '<th style="padding:5px 10px;font-size:10px;text-align:right">Valor $</th>'+
        '<th style="padding:5px 10px;font-size:10px;text-align:left">Referencia</th>'+
      '</tr></thead><tbody>'+
      g.movimientos.map(function(item){
        return '<tr style="border-bottom:1px solid var(--border)">'+
          '<td style="padding:5px 10px;font-size:11px">'+item.m.fecha+'</td>'+
          '<td style="padding:5px 10px;font-size:11px;font-family:monospace">'+(item.comp.codigo||'—')+'</td>'+
          '<td style="padding:5px 10px;font-size:11px">'+(item.comp.desc||'—')+'</td>'+
          '<td style="padding:5px 10px;font-size:11px;text-align:center;font-weight:700">'+item.m.cant+(item.comp.unidad?' '+item.comp.unidad:'')+'</td>'+
          '<td style="padding:5px 10px;font-size:11px;text-align:right">'+(item.m.precio?'$'+Math.round(item.m.precio).toLocaleString('es-AR'):'—')+'</td>'+
          '<td style="padding:5px 10px;font-size:11px;text-align:right">'+(item.valor>0?'$'+Math.round(item.valor).toLocaleString('es-AR'):'—')+'</td>'+
          '<td style="padding:5px 10px;font-size:11px">'+(item.m.ref||'—')+'</td>'+
        '</tr>';
      }).join('')+
      '</tbody></table></div></div>';
  });

  reporteContainer('📥 Entradas por origen', h);
}

function limpiarFiltrosREO(){
  var d=document.getElementById('reo-desde');  if(d) d.value='';
  var h=document.getElementById('reo-hasta');  if(h) h.value='';
  var c=document.getElementById('reo-comp');   if(c) c.value='';
  var o=document.getElementById('reo-origen'); if(o) o.value='';
  reporteEntradasPorOrigen();
}

// Limpiar filtros del reporte salidas por motivo
function limpiarFiltrosSM(){
  var d=document.getElementById('rsm-desde');  if(d) d.value='';
  var h=document.getElementById('rsm-hasta');  if(h) h.value='';
  var c=document.getElementById('rsm-comp');   if(c) c.value='';
  var m=document.getElementById('rsm-motivo'); if(m) m.value='';
  reporteSalidasPorMotivo();
}

// REPORTE: Salidas por motivo ================================
function reporteSalidasPorMotivo(){
  var hoy = today();
  var primerMes = hoy.slice(0,7)+'-01';

  // Leer filtros si ya están en DOM
  var fDesde  = document.getElementById('rsm-desde')  ? document.getElementById('rsm-desde').value  : primerMes;
  var fHasta  = document.getElementById('rsm-hasta')  ? document.getElementById('rsm-hasta').value  : hoy;
  var fComp   = document.getElementById('rsm-comp')   ? document.getElementById('rsm-comp').value.toLowerCase()   : '';
  var fMotivo = document.getElementById('rsm-motivo') ? document.getElementById('rsm-motivo').value : '';

  // Solo movimientos de Salida manual en rango
  var salidas = DB.movimientos.filter(function(m){
    if(m.tipo !== 'Salida manual') return false;
    if(fDesde && m.fecha < fDesde) return false;
    if(fHasta && m.fecha > fHasta) return false;
    if(fComp){
      var comp = DB.componentes.find(function(c){return c.id===(m.cid||m.compId);});
      if(!comp || !(comp.desc+comp.codigo).toLowerCase().includes(fComp)) return false;
    }
    if(fMotivo && (m.nota||'').trim() !== fMotivo) return false;
    return true;
  });

  // Agrupar por motivo
  var grupos = {};
  salidas.forEach(function(m){
    var mot = (m.nota||'Sin motivo').trim() || 'Sin motivo';
    if(!grupos[mot]) grupos[mot] = {movimientos:[], totalCant:0, totalValor:0};
    var comp = DB.componentes.find(function(c){return c.id===(m.cid||m.compId);})||{};
    var valor = (parseFloat(m.cant)||0) * (parseFloat(comp.costo||comp.precio)||0);
    grupos[mot].movimientos.push({m:m, comp:comp, valor:valor});
    grupos[mot].totalCant += parseFloat(m.cant)||0;
    grupos[mot].totalValor += valor;
  });

  var motivosOrdenados = Object.keys(grupos).sort(function(a,b){
    return grupos[b].totalValor - grupos[a].totalValor;
  });

  var tc = (DB.config&&DB.config.tipoCambio)||1;

  var h = '<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px">'+
    '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Desde</label>'+
      '<input id="rsm-desde" type="date" value="'+fDesde+'" onchange="reporteSalidasPorMotivo()" '+
      'style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)"></div>'+
    '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Hasta</label>'+
      '<input id="rsm-hasta" type="date" value="'+fHasta+'" onchange="reporteSalidasPorMotivo()" '+
      'style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)"></div>'+
    '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Componente</label>'+
      '<input id="rsm-comp" value="'+(fComp||'')+'" placeholder="Filtrar por componente..." onchange="reporteSalidasPorMotivo()" '+
      'style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)"></div>'+
    '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Motivo</label>'+
      '<select id="rsm-motivo" onchange="reporteSalidasPorMotivo()" style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)">'+
        '<option value="">Todos los motivos</option>'+
        (function(){
          var usados=[...new Set(DB.movimientos.filter(function(x){return x.tipo==='Salida manual'&&x.nota;}).map(function(x){return x.nota.trim();}))].sort();
          return usados.map(function(mot){return '<option value="'+mot+'"'+(mot===fMotivo?' selected':'')+'>'+mot+'</option>';}).join('');
        })()+
      '</select></div>'+
    '<button class="btn btn-sm" onclick="limpiarFiltrosSM()">✕ Limpiar</button>'+
  '</div>';

  if(!salidas.length){
    h += '<div class="empty">Sin salidas manuales en el período seleccionado.</div>';
    reporteContainer('📤 Salidas por motivo', h);
    return;
  }

  // Stats generales
  var totalMov = salidas.length;
  var totalValor = salidas.reduce(function(a,m){
    var comp = DB.componentes.find(function(c){return c.id===(m.cid||m.compId);})||{};
    return a + (parseFloat(m.cant)||0)*(parseFloat(comp.costo||comp.precio)||0);
  },0);

  h += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">'+
    '<div class="stat"><div class="stat-n">'+totalMov+'</div><div class="stat-l">Movimientos</div></div>'+
    '<div class="stat"><div class="stat-n">'+motivosOrdenados.length+'</div><div class="stat-l">Motivos distintos</div></div>'+
    '<div class="stat"><div class="stat-n red">$'+Math.round(totalValor).toLocaleString('es-AR')+'</div><div class="stat-l">Valor total</div></div>'+
  '</div>';

  // Un bloque por motivo
  motivosOrdenados.forEach(function(mot){
    var g = grupos[mot];
    var pct = totalValor > 0 ? Math.round(g.totalValor/totalValor*100) : 0;

    h += '<div class="card" style="margin-bottom:10px">'+
      '<div class="ch">'+
        '<div class="ct">'+mot+'</div>'+
        '<div style="display:flex;gap:10px;align-items:center;font-size:12px">'+
          '<span style="color:var(--text2)">'+g.movimientos.length+' mov.</span>'+
          '<span style="font-weight:700;color:var(--red)">$'+Math.round(g.totalValor).toLocaleString('es-AR')+'</span>'+
          '<span style="color:var(--text2);font-size:11px">'+pct+'% del total</span>'+
        '</div>'+
      '</div>'+
      '<div class="card-body">'+
      // Barra de progreso
      '<div style="background:var(--surface2);border-radius:3px;height:4px;margin-bottom:10px;overflow:hidden">'+
        '<div style="height:100%;background:var(--red);width:'+pct+'%"></div>'+
      '</div>'+
      '<table style="width:100%;border-collapse:collapse">'+
      '<thead><tr style="background:var(--surface2)">'+
        '<th style="padding:5px 10px;font-size:10px;text-align:left">Fecha</th>'+
        '<th style="padding:5px 10px;font-size:10px;text-align:left">Código</th>'+
        '<th style="padding:5px 10px;font-size:10px;text-align:left">Componente</th>'+
        '<th style="padding:5px 10px;font-size:10px;text-align:center">Cant.</th>'+
        '<th style="padding:5px 10px;font-size:10px;text-align:right">Valor $</th>'+
      '</tr></thead><tbody>'+
      g.movimientos.map(function(item){
        return '<tr style="border-bottom:1px solid var(--border)">'+
          '<td style="padding:5px 10px;font-size:11px">'+item.m.fecha+'</td>'+
          '<td style="padding:5px 10px;font-size:11px;font-family:monospace">'+(item.comp.codigo||'—')+'</td>'+
          '<td style="padding:5px 10px;font-size:11px">'+( item.comp.desc||'—')+'</td>'+
          '<td style="padding:5px 10px;font-size:11px;text-align:center;font-weight:700">'+item.m.cant+(item.comp.unidad?' '+item.comp.unidad:'')+'</td>'+
          '<td style="padding:5px 10px;font-size:11px;text-align:right">'+(item.valor>0?'$'+Math.round(item.valor).toLocaleString('es-AR'):'—')+'</td>'+
        '</tr>';
      }).join('')+
      '</tbody></table></div></div>';
  });

  reporteContainer('📤 Salidas por motivo', h);
}

// =RDENES =============================================
function renderOrdenes(){
  const tb=document.getElementById('tbody-ord');
  if(!DB.ordenes.length){tb.innerHTML='<tr><td colspan="7" class="empty">Sin órdenes de compra.</td></tr>';return;}
  var q=(document.getElementById('q-ord')?document.getElementById('q-ord').value||'':'').toLowerCase();
  const list=[...DB.ordenes].filter(function(o){
    return !q||((o.numero||'')+(o.proveedor||'')+(o.estado||'')).toLowerCase().includes(q);
  }).sort(function(a,b){
    return (b.fecha||'').localeCompare(a.fecha||'');
  });
  tb.innerHTML=list.map(function(o){
    const estPill={'Pendiente':'p-a',Enviada:'p-b',Recibida:'p-g',Cancelada:'p-r'};
    const items=o.items.map(function(i){
      const c=DB.componentes.find(function(x){return x.id===i.cid;})||{desc:'?'};
      return c.desc+' ('+i.cant+')';
    }).join(', ');
    const total=o.items.reduce(function(a,i){
      const c=DB.componentes.find(function(x){return x.id===i.cid;})||{precio:0};
      return a+(c.precio||0)*i.cant;
    },0);
    return '<tr>'+
      '<td>'+o.fecha+'</td>'+
      '<td><span class="pill '+(estPill[o.estado]||'p-x')+'">'+o.estado+'</span></td>'+
      '<td style="font-size:11px">'+items+'</td>'+
      '<td>'+(o.proveedor||'—')+'</td>'+
      '<td>'+(total?'$'+Math.round(total).toLocaleString('es-AR'):'—')+'</td>'+
      '<td style="font-size:11px">'+(o.obs||'—')+'</td>'+
      '<td style="display:flex;gap:4px">'+
        '<button class="btn btn-sm" onclick="cambiarEstadoOrden('+o.id+')">📋</button>'+
        '<button class="btn btn-sm btn-p" onclick="pdfOrden('+o.id+')">📄</button>'+
        '<button class="btn btn-sm" style="color:var(--red)" onclick="eliminarOrden('+o.id+')">🗑️</button>'+
      '</td>'+
    '</tr>';
  }).join('');
}

function generarOrdenAutomatica(){
  const criticos=DB.componentes.filter(function(c){
    var min=parseFloat(c.min)||0;
    return min>0 && stockActual(c.id)<min;
  });
  if(!criticos.length){alert('No hay componentes por debajo del stock mínimo (con mínimo > 0).');return;}

  // Group by proveedor
  var porProv = {};
  criticos.forEach(function(c){
    var prov = c.proveedor||'Sin proveedor';
    if(!porProv[prov]) porProv[prov]=[];
    var faltante=Math.max(1,(parseFloat(c.min)||1)-stockActual(c.id)+Math.ceil((parseFloat(c.min)||1)));
    porProv[prov].push({cid:c.id, cant:faltante});
  });

  var count = Object.keys(porProv).length;
  if(!confirm('Se generarán '+count+' orden'+(count>1?'es':'')+' de compra (una por proveedor). ¿Continuar?')) return;

  Object.entries(porProv).forEach(function(entry){
    var prov=entry[0], items=entry[1];
    DB.ordenes.unshift({
      id:DB.nid++, fecha:today(), estado:'Pendiente',
      items:items, proveedor:prov,
      obs:'Generada automáticamente — stock crítico'
    });
  });

  save(); renderOrdenes();
  alert('Se generaron '+count+' orden'+(count>1?'es':'')+' de compra por proveedor.');
}


function getNumOC(){
  var yr = new Date().getFullYear();
  var same = DB.ordenes.filter(function(o){
    return o.numero && o.numero.startsWith('OC-'+yr);
  });
  var max = 0;
  same.forEach(function(o){
    var n = parseInt((o.numero||'').split('-')[2]||'0');
    if(n>max) max=n;
  });
  return 'OC-'+yr+'-'+String(max+1).padStart(4,'0');
}

function modalOrden(){
  const compOpts=[...DB.componentes].sort(function(a,b){var sa=(a.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();var sb=(b.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();return sa.localeCompare(sb,'es');}).map(function(c){
    return '<option value="'+c.id+'">'+c.codigo+' — '+c.desc+'</option>';
  }).join('');
  openModal('Nueva orden de compra',
    '<div id="orden-items"><div class="fg2" style="margin-bottom:8px" id="orden-item-0">'+
      '<div class="fg"><label>Componente *</label>'+
        '<select class="ord-cid" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
          '<option value="">-- seleccionar --</option>'+compOpts+'</select></div>'+
      '<div class="fg"><label>Cantidad *</label><input class="ord-cant" type="number" min="1" value="1"></div>'+
    '</div></div>'+
    '<button class="btn btn-sm" onclick="addOrdenItem()" style="margin-bottom:10px">➕ Agregar ítem</button>'+
    '<div class="fg"><label>Proveedor</label>'+
      '<select id="ord-prov" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
        '<option value="">-- sin vincular --</option>'+
        [...DB.proveedores].sort(function(a,b){return (a.empresa||'').localeCompare(b.empresa||'');}).map(function(p){return '<option value="'+p.empresa+'">'+p.empresa+'</option>';}).join('')+
      '</select></div>'+
    '<div class="fg"><label>Observaciones</label><input id="ord-obs" placeholder="Notas..."></div>',
    function(){
      const cids=[...document.querySelectorAll('.ord-cid')].map(function(s){return parseInt(s.value);});
      const cants=[...document.querySelectorAll('.ord-cant')].map(function(i){return parseFloat(i.value)||0;});
      const items=cids.map(function(cid,i){return {cid:cid,cant:cants[i]};}).filter(function(x){return x.cid&&x.cant>0;});
      if(!items.length){alert('Agregá al menos un componente con cantidad.');return false;}
      DB.ordenes.unshift({
        id:DB.nid++, numero:getNumOC(), fecha:today(), estado:'Pendiente',
        items:items,
        proveedor:document.getElementById('ord-prov').value,
        obs:document.getElementById('ord-obs').value
      });
      save();renderOrdenes();return true;
    });
}

function addOrdenItem(){
  const cont=document.getElementById('orden-items');
  const idx=cont.children.length;
  const compOpts=[...DB.componentes].sort(function(a,b){var sa=(a.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();var sb=(b.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();return sa.localeCompare(sb,'es');}).map(function(c){
    return '<option value="'+c.id+'">'+c.codigo+' — '+c.desc+'</option>';
  }).join('');
  const div=document.createElement('div');
  div.className='fg2';div.style.marginBottom='8px';
  div.innerHTML='<div class="fg"><label>Componente *</label>'+
    '<select class="ord-cid" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
    '<option value="">-- seleccionar --</option>'+compOpts+'</select></div>'+
    '<div class="fg"><label>Cantidad *</label><input class="ord-cant" type="number" min="1" value="1"></div>';
  cont.appendChild(div);
}

function cambiarEstadoOrden(id){
  const o=DB.ordenes.find(function(x){return x.id===id;});
  if(!o) return;
  const estados=['Pendiente','Enviada','Recibida','Cancelada'];
  const cur=estados.indexOf(o.estado);
  if(cur===estados.length-1){alert('Esta orden está Cancelada y no puede avanzar de estado.');return;}
  if(o.estado==='Recibida'){alert('Esta orden ya fue recibida. No se puede modificar el estado.');return;}
  const sig=estados[cur+1];
  if(!confirm('Cambiar estado a "'+sig+'"?'))return;
  o.estado=sig;
  if(sig==='Recibida'){
    o.items.forEach(function(item){
      DB.movimientos.push({
        id:DB.nid++, cid:item.cid, tipo:'Entrada',
        cant:item.cant, fecha:today(),
        ref:'Orden #'+o.id, lote:'', precio:0, nota:'Recepción orden de compra'
      });
    });
    alert('Stock actualizado automáticamente con los ítems recibidos.');
  }
  save();renderOrdenes();renderStock();
}

function borrarMovimiento(id){
  var m = DB.movimientos.find(function(x){return x.id===id;});
  if(!m) return;
  var comp = DB.componentes.find(function(c){return c.id===(m.cid||m.compId);});
  var desc = comp?comp.desc:'componente';
  if(!confirm('¿Eliminar el movimiento de '+m.tipo.toLowerCase()+' de "'+desc+'" del '+m.fecha+'?')) return;
  DB.movimientos = DB.movimientos.filter(function(x){return x.id!==id;});
  save(); renderMovimientos(); renderStock();
}

function editarMovimiento(id){
  const m=DB.movimientos.find(function(x){return x.id===id;});
  if(!m) return;
  const comp=DB.componentes.find(function(c){return c.id===m.cid;})||{desc:'?'};
  const tc=(DB.config&&DB.config.tipoCambio)||1;
  openModal('Editar movimiento — '+comp.desc,
    '<div class="fg2">'+
    '<div class="fg"><label>Fecha</label><input id="em-fecha" type="date" value="'+(m.fecha||today())+'"></div>'+
    '<div class="fg"><label>Precio unitario ($)</label><input id="em-precio" type="number" min="0" value="'+(m.precio||0)+'"></div>'+
    '<div class="fg"><label>Precio U$S (calculado)</label><input readonly value="'+(m.precio&&tc>0?(m.precio/tc).toFixed(2):'')+'" style="background:var(--surface2)"></div>'+
    '<div class="fg"><label>Referencia</label><input id="em-ref" value="'+(m.ref||'')+'"></div>'+
    '<div class="fg"><label>Lote</label><input id="em-lote" value="'+(m.lote||'')+'"></div>'+
    '<div class="fg"><label>Nota</label><input id="em-nota" value="'+(m.nota||'')+'"></div>'+
    '<div class="fg"><label>Estado material</label>'+
      '<select id="em-emat" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
        '<option value="N"'+(m.estadoMat!=='R'?' selected':'')+'>N — Nuevo</option>'+
        '<option value="R"'+(m.estadoMat==='R'?' selected':'')+'>R — Recuperado</option>'+
      '</select></div>'+
    '</div>',
    function(){
      m.fecha=document.getElementById('em-fecha').value;
      m.precio=parseFloat(document.getElementById('em-precio').value)||0;
      m.ref=document.getElementById('em-ref').value;
      m.lote=document.getElementById('em-lote').value;
      m.nota=document.getElementById('em-nota').value;
      m.estadoMat=document.getElementById('em-emat')?document.getElementById('em-emat').value:'N';
      save(); renderMovimientos(); return true;
    });
}

function eliminarOrden(id){
  if(!confirm('¿Eliminar esta orden?'))return;
  DB.ordenes=DB.ordenes.filter(function(x){return x.id!==id;});
  save();renderOrdenes();
}

function pdfOrden(id){
  const o=DB.ordenes.find(function(x){return x.id===id;});
  if(!o) return;
  const tc=(DB.config&&DB.config.tipoCambio)||1;
  let rows='';
  o.items.forEach(function(item){
    const c=DB.componentes.find(function(x){return x.id===item.cid;})||{codigo:'?',desc:'?',unidad:'u',precio:0,ubicacion:''};
    const sub=(c.costo||c.precio||0)*item.cant;
    rows+='<tr><td>'+c.codigo+'</td><td>'+c.desc+'</td><td style="text-align:center">'+item.cant+' '+c.unidad+'</td>'+
      '<td style="text-align:right">$'+Math.round(c.costo||c.precio||0).toLocaleString('es-AR')+'</td>'+
      '<td style="text-align:right">$'+Math.round(sub).toLocaleString('es-AR')+'</td>'+
      '<td>'+( c.ubicacion||'—')+'</td></tr>';
  });
  const total=o.items.reduce(function(a,i){const c=DB.componentes.find(function(x){return x.id===i.cid;})||{costo:0,precio:0};return a+(c.costo||c.precio||0)*i.cant;},0);
  const w=window.open('','_blank');
  w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Orden #'+o.id+'</title>'+
    '<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Segoe UI,Arial,sans-serif;padding:28px;font-size:13px}'+
    'h1{font-size:18px;font-weight:700;color:#256282;margin-bottom:4px}'+
    '.meta{font-size:12px;color:#666;margin-bottom:20px}'+
    'table{width:100%;border-collapse:collapse}th{background:#256282;color:#fff;padding:8px 12px;text-align:left;font-size:11px}'+
    'td{padding:7px 12px;border-bottom:1px solid #eee;font-size:12px}'+
    'tfoot td{background:#f8f8f8;font-weight:700}'+
    '.btn-print{position:fixed;top:14px;right:14px;background:#256282;color:#fff;border:none;padding:8px 18px;border-radius:6px;cursor:pointer;font-size:12px}'+
    '@media print{.btn-print{display:none}}</style></head><body>'+
    '<button class="btn-print" onclick="window.print()">🖨️ Imprimir</button>'+
    '<h1>ORDEN DE COMPRA — '+(o.numero||'OC')+'</h1>'+
    '<div class="meta">Riego Adaptativo &nbsp;·&nbsp; Orden #'+o.id+' &nbsp;·&nbsp; Fecha: '+o.fecha+' &nbsp;·&nbsp; Estado: '+o.estado+
    (o.proveedor?'<br>Proveedor: <strong>'+o.proveedor+'</strong>':'')+
    (o.obs?'<br>Obs: '+o.obs:'')+'</div>'+
    '<table><thead><tr><th>Código</th><th>Descripción</th><th style="text-align:center">Cantidad</th><th style="text-align:right">P. unitario</th><th style="text-align:right">Subtotal</th><th>Ubicación</th></tr></thead>'+
    '<tbody>'+rows+'</tbody>'+
    '<tfoot><tr><td colspan="4" style="text-align:right;padding:8px 12px">TOTAL ESTIMADO</td>'+
    '<td style="text-align:right;padding:8px 12px;color:#256282">$'+Math.round(total).toLocaleString('es-AR')+'</td><td></td></tr></tfoot>'+
    '</table></body></html>');
  w.document.close();
}



function enviarEmailPres(id){
  const p=DB.presupuestos.find(function(x){return x.id===id;});
  if(!p) return;
  const emailDest = p.email || '';
  const cfg = DB.config || {};
  const num = presNum(p);
  const empresa = cfg.empresa || 'Riego Adaptativo';
  const firma = cfg.firma || empresa;
  const asunto = encodeURIComponent('Presupuesto ' + num + ' - ' + empresa);
  const cuerpo = encodeURIComponent(
    'Estimado/a ' + p.nombre + ',\n\n' +
    'Le enviamos el presupuesto ' + num + ' correspondiente a ' + (getLineaPres(p)?getLineaPres(p).nombre:'su sistema') + '.\n\n' +
    'Validez: ' + (p.validez||15) + ' dias corridos.\n\n' +
    'Ante cualquier consulta no dude en contactarnos.\n\n' +
    'Saludos cordiales,\n' + firma +
    (cfg.tel ? '\nTel: ' + cfg.tel : '') +
    (cfg.email ? '\n' + cfg.email : '')
  );
  alert('📎 Se va a abrir Gmail con el texto listo, pero el PDF NO se adjunta solo.\n\nSi todavía no lo generaste, tocá primero "📄 PDF", guardalo, y después adjuntalo a mano en Gmail (clip 📎) antes de enviar.');
  // Open Gmail compose
  var gmailUrl = 'https://mail.google.com/mail/?view=cm&fs=1' +
    (emailDest ? '&to=' + encodeURIComponent(emailDest) : '') +
    '&su=' + asunto +
    '&body=' + cuerpo;
  window.open(gmailUrl, '_blank');
  // Mark as sent
  setTimeout(function(){
    if(confirm('¿Marcar el presupuesto como Enviado?')){
      p.estado='Enviado';
      save();
      renderPresupuestos();
    }
  }, 1000);
}

// =======================================================

// CONFIGURACION ============================================

function resetearContadores(){
  if(!confirm('¿Reiniciar todos los contadores? Los números de OC y presupuestos volverán a empezar desde 1.')) return;
  if(!confirm('Última confirmación. Esta acción no se puede deshacer.')) return;
  DB.nid = 1;
  // Reset OC numbers
  DB.ordenes.forEach(function(o,i){ o.id = i+1; });
  // Reset presupuesto correlativos
  DB.presupuestos.forEach(function(p,i){ p.correlativo = i+1; });
  if(DB.ordenes.length) DB.nid = Math.max(DB.nid, DB.ordenes.length+1);
  if(DB.presupuestos.length) DB.nid = Math.max(DB.nid, DB.presupuestos.length+1);
  save();
  renderConfig();
  alert('Contadores reiniciados correctamente.');
}


function actualizarTC(){
  var btn = document.querySelector('[onclick="actualizarTC()"]');
  var info = document.getElementById('cfg-tc-info');
  if(btn) btn.textContent = '⏳';
  if(info) info.textContent = 'Consultando...';

  fetch('https://api.bluelytics.com.ar/v2/latest')
    .then(function(r){ return r.json(); })
    .then(function(data){
      if(data && data.oficial && data.oficial.value_sell){
        var venta = Math.round(data.oficial.value_sell);
        var el = document.getElementById('cfg-tc');
        if(el) el.value = venta;
        if(btn) btn.textContent = '✅';
        var fecha = data.last_update ? new Date(data.last_update).toLocaleString('es-AR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
        if(info) info.textContent = 'Venta oficial: $'+venta.toLocaleString('es-AR')+(fecha?' · '+fecha:'');
        saveConfig();
        setTimeout(function(){ if(btn) btn.textContent = '🔄 BNA'; }, 3000);
      } else {
        throw new Error('Sin datos');
      }
    })
    .catch(function(err){
      if(btn) btn.textContent = '🔄 BNA';
      if(info) info.textContent = 'Error al consultar. Ingresá manualmente.';
      console.error('TC fetch error:', err);
    });
}

function renderConfig(){
  var cfg = DB.config || {};
  var el = document.getElementById('config-body');
  if(!el){ console.error('config-body not found'); return; }
  var h = '';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">';
  h += cfgInp('Nombre de la empresa','cfg-empresa', cfg.empresa||'', 'Riego Adaptativo');
  h += cfgInp('Email de contacto','cfg-email', cfg.email||'', 'contacto@empresa.com');
  h += cfgInp('Teléfono','cfg-tel', cfg.tel||'', '+54 9 261...');
  h += cfgInp('Dirección','cfg-direccion', cfg.direccion||'', 'Calle y número, ciudad');
  h += cfgInp('Sitio web','cfg-web', cfg.web||'', 'www.empresa.com');
  h += cfgInp('Firma en emails','cfg-firma', cfg.firma||cfg.empresa||'', 'Firma para emails');
  h += '<div class="fg"><label>Tipo de cambio U$S — vendedor BNA</label><div style="display:flex;gap:6px;align-items:center"><input id="cfg-tc" type="number" min="1" value="'+(cfg.tipoCambio||1)+'" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;flex:1" onblur="saveConfig()"><button class="btn btn-sm" onclick="actualizarTC()" title="Obtener cotización actual del Banco Nación">🔄 BNA</button><span id="cfg-tc-info" style="font-size:10px;color:var(--text2)"></span></div></div>';
  h += '</div>';
  h += '<hr class="div"><div class="sectitle" style="margin-bottom:10px">Meta de facturación mensual</div>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">';
  h += cfgInp('Meta mensual ($)','cfg-meta-mensual', cfg.metaMensual?Number(cfg.metaMensual).toLocaleString('es-AR'):'0', 'Ej: 500.000');
  h += '</div>';
  h += '<div class="sectitle" style="margin-bottom:10px">Descripciones de modelos (aparecen en el PDF)</div>';
  h += '<hr class="div">';
  h += '<div class="sectitle" style="margin-bottom:10px">Contadores</div>';
  h += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">';
  h += '<div style="font-size:12px;color:var(--text2)">Numeración actual: OC #'+DB.ordenes.length+' · Presupuestos: '+DB.presupuestos.length+' · ID interno: '+DB.nid+'</div>';
  h += '<button class="btn btn-d" onclick="resetearContadores()" style="font-size:12px">🔄 Reiniciar contadores</button>';
  h += '</div>';
  h += cfgTxt('AquaOne','cfg-desc-AquaOne', cfg.desc_AquaOne||'Sistema de riego automático básico con control remoto vía Telegram. Riego programado por horario, activación y desactivación desde el celular en cualquier momento y desde cualquier lugar. Notificaciones instantáneas de cada ciclo de riego. Historial de eventos registrados con fecha y hora. Control mediante menú interactivo en Telegram — sin necesidad de aplicaciones adicionales.');
  h += cfgTxt('AquaDuo','cfg-desc-AquaDuo', cfg.desc_AquaDuo||'Todo lo de AquaOne, más sensor de humedad de suelo (Mi Flora): el riego se ajusta según la condición real de la tierra, no solo por horario fijo. Notificación cuando el sensor detecta batería baja.');
  h += cfgTxt('AquaTrio','cfg-desc-AquaTrio', cfg.desc_AquaTrio||'Todo lo de AquaDuo, más protección antihelada: monitoreo de temperatura ambiente en tiempo real y activación preventiva del riego ante riesgo de helada de irradiación, sin intervención humana.');
  h += cfgTxt('AquaPro','cfg-desc-AquaPro', cfg.desc_AquaPro||'Todo lo de AquaTrio, más sensor de nivel de reservorio y lógica adaptativa completa: cruza humedad de suelo, temperatura ambiente y pronóstico meteorológico para decidir cuándo y cuánto regar.');
  h += cfgTxt('AquaMax','cfg-desc-AquaMax', cfg.desc_AquaMax||'Máxima prestación: múltiples zonas de riego independientes controladas desde un mismo equipo, historial extendido de ciclos y decisiones del sistema, y soporte prioritario.');
  el.innerHTML = h;
}

function cfgInp(label, id, val, ph, type){
  type = type||'text';
  var v = String(val||'').replace(/"/g,"'");
  return '<div class="fg" style="margin:0"><label>'+label+'</label>'+
    '<input type="'+type+'" id="'+id+'" value="'+v+'" placeholder="'+ph+'" oninput="saveConfig()"></div>';
}

function cfgTxt(label, id, val){
  return '<div class="fg"><label>'+label+'</label>'+
    '<textarea id="'+id+'" style="min-height:60px;padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%;font-family:inherit" oninput="saveConfig()">'+val+'</textarea></div>';
}

function saveConfig(){
  if(!DB.config) DB.config={};
  var g=function(id){var el=document.getElementById(id);return el?el.value:'';};
  DB.config.empresa = g('cfg-empresa');
  DB.config.email = g('cfg-email');
  DB.config.tel = g('cfg-tel');
  DB.config.direccion = g('cfg-direccion');
  DB.config.web = g('cfg-web');
  DB.config.firma = g('cfg-firma');
  DB.config.metaMensual = parseFloat((g('cfg-meta-mensual')||'0').replace(/\./g,'').replace(',','.'))||0;
  DB.config.tipoCambio = parseFloat(g('cfg-tc'))||1;
  DB.config.desc_AquaOne = g('cfg-desc-AquaOne');
  DB.config.desc_AquaDuo = g('cfg-desc-AquaDuo');
  DB.config.desc_AquaTrio = g('cfg-desc-AquaTrio');
  DB.config.desc_AquaPro = g('cfg-desc-AquaPro');
  DB.config.desc_AquaMax = g('cfg-desc-AquaMax');
  if(_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(function(){ save(); }, 800);
}
function reporteFinanciero(){
  const tc=(DB.config&&DB.config.tipoCambio)||1;
  
  var totalSistemas=0, totalAdelantos=0, totalPagos=0, totalPendiente=0;
  var rows='';

  DB.gestiones.forEach(function(g){
    var pagosTotal=g.pagos?g.pagos.reduce(function(a,p){return a+(parseFloat(p.monto)||0);},0):0;
    var saldo=(g.montoSistema||0)-(g.adelanto||0)-pagosTotal;
    var cobrado=(g.adelanto||0)+pagosTotal;

    totalSistemas+=g.montoSistema||0;
    totalAdelantos+=g.adelanto||0;
    totalPagos+=pagosTotal;
    totalPendiente+=saldo;

    rows+='<tr>'+
      '<td><strong>'+g.clienteNombre+'</strong></td>'+
      '<td style="text-align:right">$'+Math.round(g.montoSistema||0).toLocaleString('es-AR')+'</td>'+
      '<td style="text-align:right;color:var(--green)">$'+Math.round(g.adelanto||0).toLocaleString('es-AR')+'</td>'+
      '<td style="text-align:right;color:var(--blue)">$'+Math.round(pagosTotal).toLocaleString('es-AR')+'</td>'+
      '<td style="text-align:right;font-weight:700">$'+Math.round(cobrado).toLocaleString('es-AR')+'</td>'+
      '<td style="text-align:right;font-weight:700;color:'+(saldo>0?'#E65100':'var(--green)')+'">$'+Math.round(saldo).toLocaleString('es-AR')+'</td>'+
    '</tr>';

    // Detalle pagos
    if(g.pagos&&g.pagos.length){
      g.pagos.forEach(function(p){
        rows+='<tr style="background:var(--surface2);font-size:11px">'+
          '<td style="padding-left:24px;color:var(--text2)">↳ Pago: '+p.fecha+(p.nota?' — '+p.nota:'')+'</td>'+
          '<td></td><td></td>'+
          '<td style="text-align:right;color:var(--blue)">$'+Math.round(p.monto||0).toLocaleString('es-AR')+'</td>'+
          '<td></td><td></td>'+
        '</tr>';
      });
    }
  });

  if(!DB.gestiones.length){
    reporteContainer('💰 Resumen financiero','<div class="empty">Sin gestiones económicas registradas.</div>');
    return;
  }

  var totalCobrado=totalAdelantos+totalPagos;
  var h='';

  // Stats
  // Meta mensual
  var metaCfg=(DB.config&&DB.config.metaMensual)||0;
  var mesAct=hoy.slice(0,7);
  var facMesAct=(DB.fondos||[]).filter(function(f){return f.tipo==='Ingreso'&&f.fecha&&f.fecha.slice(0,7)===mesAct;}).reduce(function(a,f){return a+(parseFloat(f.monto)||0);},0);
  var pctMeta=metaCfg>0?Math.round(facMesAct/metaCfg*100):0;

  h+='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">';
  h+='<div class="stat"><div class="stat-n">$'+Math.round(totalSistemas).toLocaleString('es-AR')+'</div><div class="stat-l">Total facturado</div></div>';
  h+='<div class="stat"><div class="stat-n green">$'+Math.round(totalCobrado).toLocaleString('es-AR')+'</div><div class="stat-l">Total cobrado</div></div>';
  h+='<div class="stat"><div class="stat-n '+(totalPendiente>0?'amber':'green')+'">$'+Math.round(totalPendiente).toLocaleString('es-AR')+'</div><div class="stat-l">Saldo pendiente</div></div>';
  h+='<div class="stat"><div class="stat-n">'+(totalSistemas>0?Math.round(totalCobrado/totalSistemas*100):0)+'%</div><div class="stat-l">% cobrado</div></div>';
  h+='</div>';

  if(tc>1){
    h+='<div style="background:var(--surface2);border-radius:var(--r);padding:8px 12px;font-size:12px;margin-bottom:14px;color:var(--text2)">'+
      'En U$S (TC $'+tc+'): '+
      'Facturado: <strong>U$S '+(totalSistemas/tc).toFixed(0)+'</strong> · '+
      'Cobrado: <strong>U$S '+(totalCobrado/tc).toFixed(0)+'</strong> · '+
      'Pendiente: <strong>U$S '+(totalPendiente/tc).toFixed(0)+'</strong>'+
    '</div>';
  }

  // Tabla por cliente
  h+='<table style="width:100%;border-collapse:collapse">'+
    '<thead><tr style="background:var(--surface2)">'+
      '<th style="padding:7px 10px;font-size:11px">Cliente</th>'+
      '<th style="padding:7px 10px;font-size:11px;text-align:right">Sistema</th>'+
      '<th style="padding:7px 10px;font-size:11px;text-align:right">Adelanto</th>'+
      '<th style="padding:7px 10px;font-size:11px;text-align:right">Pagos saldo</th>'+
      '<th style="padding:7px 10px;font-size:11px;text-align:right">Total cobrado</th>'+
      '<th style="padding:7px 10px;font-size:11px;text-align:right">Pendiente</th>'+
    '</tr></thead>'+
    '<tbody>'+rows+'</tbody>'+
    '<tfoot>'+
      '<tr style="font-weight:700;background:#0D1B24;color:#fff">'+
        '<td style="padding:8px 10px">CONSOLIDADO</td>'+
        '<td style="padding:8px 10px;text-align:right">$'+Math.round(totalSistemas).toLocaleString('es-AR')+'</td>'+
        '<td style="padding:8px 10px;text-align:right">$'+Math.round(totalAdelantos).toLocaleString('es-AR')+'</td>'+
        '<td style="padding:8px 10px;text-align:right">$'+Math.round(totalPagos).toLocaleString('es-AR')+'</td>'+
        '<td style="padding:8px 10px;text-align:right">$'+Math.round(totalCobrado).toLocaleString('es-AR')+'</td>'+
        '<td style="padding:8px 10px;text-align:right;color:'+(totalPendiente>0?'#FFB74D':'#81C784')+'">$'+Math.round(totalPendiente).toLocaleString('es-AR')+'</td>'+
      '</tr>'+
    '</tfoot>'+
  '</table>';

  // Add print button
  h = '<div style="display:flex;justify-content:flex-end;margin-bottom:10px">'+
    '<button class="btn btn-p" onclick="imprimirReporteFinanciero()">🖨️ Imprimir PDF</button>'+
  '</div>' + h;
  reporteContainer('💰 Resumen financiero', h);
}

function imprimirReporteFinanciero(){
  const tc=(DB.config&&DB.config.tipoCambio)||1;
  const empresa=(DB.config&&DB.config.empresa)||'Riego Adaptativo';

  var totalSistemas=0, totalAdelantos=0, totalPagos=0;
  var rows='';

  DB.gestiones.forEach(function(g){
    var pagosTotal=g.pagos?g.pagos.reduce(function(a,p){return a+(parseFloat(p.monto)||0);},0):0;
    var saldo=(g.montoSistema||0)-(g.adelanto||0)-pagosTotal;
    var cobrado=(g.adelanto||0)+pagosTotal;
    totalSistemas+=g.montoSistema||0;
    totalAdelantos+=g.adelanto||0;
    totalPagos+=pagosTotal;

    rows+='<tr>'+
      '<td><strong>'+g.clienteNombre+'</strong></td>'+
      '<td style="text-align:right">$'+Math.round(g.montoSistema||0).toLocaleString('es-AR')+'</td>'+
      '<td style="text-align:right">$'+Math.round(g.adelanto||0).toLocaleString('es-AR')+'</td>'+
      '<td style="text-align:right">$'+Math.round(pagosTotal).toLocaleString('es-AR')+'</td>'+
      '<td style="text-align:right;font-weight:700">$'+Math.round(cobrado).toLocaleString('es-AR')+'</td>'+
      '<td style="text-align:right;font-weight:700;color:'+(saldo>0?'#E65100':'green')+'">$'+Math.round(saldo).toLocaleString('es-AR')+'</td>'+
    '</tr>';
    if(g.pagos&&g.pagos.length){
      g.pagos.forEach(function(p){
        rows+='<tr style="background:#f8f8f8;font-size:10px"><td style="padding-left:22px;color:#666">↳ '+p.fecha+(p.nota?' — '+p.nota:'')+'</td>'+
          '<td></td><td></td><td style="text-align:right">$'+Math.round(p.monto||0).toLocaleString('es-AR')+'</td><td></td><td></td></tr>';
      });
    }
  });

  var totalCobrado=totalAdelantos+totalPagos;
  var totalPendiente=totalSistemas-totalCobrado;

  var css='*{box-sizing:border-box;margin:0;padding:0}body{font-family:Segoe UI,Arial,sans-serif;padding:24px;font-size:12px}'+
    'h1{font-size:16px;color:#256282;margin-bottom:2px}.meta{font-size:11px;color:#666;margin-bottom:16px}'+
    '.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}'+
    '.stat{background:#f5f5f5;border-radius:6px;padding:10px;text-align:center}'+
    '.stat .n{font-size:15px;font-weight:700;margin-bottom:2px}.stat .l{font-size:9px;color:#888;text-transform:uppercase}'+
    'table{width:100%;border-collapse:collapse}'+
    'th{background:#256282;color:#fff;padding:7px 10px;font-size:10px;text-align:left}'+
    'td{padding:6px 10px;border-bottom:1px solid #eee}'+
    'tfoot td{background:#222;color:#fff;font-weight:700}'+
    '.btn{position:fixed;top:12px;right:12px;background:#256282;color:#fff;border:none;padding:7px 16px;border-radius:6px;cursor:pointer}'+
    '@media print{.btn{display:none}@page{margin:12mm}}';

  var w=window.open('','_blank');
  w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Resumen financiero</title><style>'+css+'</style></head><body>'+
    '<button class="btn" onclick="window.print()">🖨️ Imprimir</button>'+
    '<h1>RESUMEN FINANCIERO</h1>'+
    '<div class="meta">'+empresa+' · '+today()+'</div>'+
    '<div class="stats">'+
      '<div class="stat"><div class="n">$'+Math.round(totalSistemas).toLocaleString('es-AR')+'</div><div class="l">Total facturado</div></div>'+
      '<div class="stat"><div class="n" style="color:green">$'+Math.round(totalCobrado).toLocaleString('es-AR')+'</div><div class="l">Total cobrado</div></div>'+
      '<div class="stat"><div class="n" style="color:'+(totalPendiente>0?'#E65100':'green')+'">$'+Math.round(totalPendiente).toLocaleString('es-AR')+'</div><div class="l">Saldo pendiente</div></div>'+
      '<div class="stat"><div class="n">'+(totalSistemas>0?Math.round(totalCobrado/totalSistemas*100):0)+'%</div><div class="l">% cobrado</div></div>'+
    '</div>'+
    (tc>1?'<div style="background:#FFF8E1;border-radius:5px;padding:7px 12px;font-size:11px;margin-bottom:14px;color:#7B4F00">'+
      'TC $'+tc+' — Facturado: U$S '+(totalSistemas/tc).toFixed(0)+
      ' · Cobrado: U$S '+(totalCobrado/tc).toFixed(0)+
      ' · Pendiente: U$S '+(totalPendiente/tc).toFixed(0)+'</div>':'')+
    '<table><thead><tr><th>Cliente</th><th style="text-align:right">Sistema</th><th style="text-align:right">Adelanto</th><th style="text-align:right">Pagos saldo</th><th style="text-align:right">Total cobrado</th><th style="text-align:right">Pendiente</th></tr></thead>'+
    '<tbody>'+rows+'</tbody>'+
    '<tfoot><tr>'+
      '<td style="padding:8px 10px">CONSOLIDADO</td>'+
      '<td style="padding:8px 10px;text-align:right">$'+Math.round(totalSistemas).toLocaleString('es-AR')+'</td>'+
      '<td style="padding:8px 10px;text-align:right">$'+Math.round(totalAdelantos).toLocaleString('es-AR')+'</td>'+
      '<td style="padding:8px 10px;text-align:right">$'+Math.round(totalPagos).toLocaleString('es-AR')+'</td>'+
      '<td style="padding:8px 10px;text-align:right">$'+Math.round(totalCobrado).toLocaleString('es-AR')+'</td>'+
      '<td style="padding:8px 10px;text-align:right;color:'+(totalPendiente>0?'#FFB74D':'#81C784')+'">$'+Math.round(totalPendiente).toLocaleString('es-AR')+'</td>'+
    '</tr></tfoot></table>'+
    '</body></html>');
  w.document.close();
}




// REPORTES ================================================
function cerrarReporte(){
  var el=document.getElementById('reporte-resultado');
  if(el) el.innerHTML='';
}

function reporteContainer(titulo, html){
  document.getElementById('reporte-resultado').innerHTML =
    '<div class="card" style="margin-top:10px">'+
    '<div class="ch"><div class="ct">'+titulo+'</div>'+
    '<button class="btn btn-sm" onclick="cerrarReporte()">✕ Cerrar</button></div>'+
    '<div class="card-body">'+html+'</div></div>';
}

function reporteClientes(){
  var modelos=['AquaOne','AquaDuo','AquaTrio','AquaPro','AquaMax'];
  var activos=DB.clientes.filter(function(c){return c.estado==='Activo';});
  var bajas=DB.clientes.filter(function(c){return c.estado==='Baja';});

  // Summary stats
  var h='<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:14px">';
  modelos.forEach(function(m){
    var n=activos.filter(function(c){return c.modelo===m;}).length;
    h+='<div class="stat"><div class="stat-n">'+n+'</div><div class="stat-l">'+m+'</div></div>';
  });
  h+='</div>';

  // Model filter
  var fModelo=document.getElementById('rc-modelo')?document.getElementById('rc-modelo').value:'';
  h+='<div style="margin-bottom:10px;display:flex;align-items:center;gap:8px">'+
    '<label style="font-size:11px;color:var(--text2)">Filtrar por modelo:</label>'+
    '<select id="rc-modelo" onchange="reporteClientes()" style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)">'+
      '<option value="">Todos</option>'+
      modelos.map(function(m){return '<option value="'+m+'"'+(m===fModelo?' selected':'')+'>'+m+'</option>';}).join('')+
    '</select>'+
    '<span style="font-size:11px;color:var(--text2)">'+
      (fModelo?activos.filter(function(c){return c.modelo===fModelo;}).length:activos.length)+' cliente'+
      ((fModelo?activos.filter(function(c){return c.modelo===fModelo;}).length:activos.length)!==1?'s':'')+' activos'+
    '</span>'+
  '</div>';

  // Client list
  var lista=activos.filter(function(c){return !fModelo||c.modelo===fModelo;})
    .sort(function(a,b){return (a.modelo+a.nombre).localeCompare(b.modelo+b.nombre);});

  h+='<table><thead><tr><th>Cliente</th><th>Lote / Barrio</th><th>Modelo</th><th>Fecha inst.</th></tr></thead><tbody>';
  lista.forEach(function(c){
    h+='<tr>'+
      '<td><strong>'+c.nombre+'</strong></td>'+
      '<td style="font-size:11px;color:var(--text2)">'+(c.lote||'')+(c.barrio?' · '+c.barrio:'')+'</td>'+
      '<td>'+mPill(c.modelo)+'</td>'+
      '<td style="font-size:11px">'+(c.fecha||'—')+'</td>'+
    '</tr>';
  });
  h+='</tbody></table>';
  reporteContainer('👥 Clientes por modelo', h);
}

function limpiarFiltrosPres(){
  var d=document.getElementById('rpres-desde');
  var h=document.getElementById('rpres-hasta');
  if(d) d.value='';
  if(h) h.value='';
  reportePresupuestos();
}

function reportePresupuestos(){
  var tc=(DB.config&&DB.config.tipoCambio)||1;
  var fDesde=document.getElementById('rpres-desde')?document.getElementById('rpres-desde').value:'';
  var fHasta=document.getElementById('rpres-hasta')?document.getElementById('rpres-hasta').value:'';
  var hoy=today();
  var primerMes=hoy.slice(0,7)+'-01';

  var lista=DB.presupuestos.filter(function(p){
    return (!fDesde||p.fecha>=fDesde) && (!fHasta||p.fecha<=fHasta);
  });

  var estados=['Borrador','Enviado','Aprobado','Rechazado'];
  var h='<div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:12px;flex-wrap:wrap">'+
    '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Desde</label>'+
      '<input id="rpres-desde" type="date" value="'+(fDesde||primerMes)+'" onchange="reportePresupuestos()" '+
      'style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)"></div>'+
    '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Hasta</label>'+
      '<input id="rpres-hasta" type="date" value="'+(fHasta||hoy)+'" onchange="reportePresupuestos()" '+
      'style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)"></div>'+
    '<button class="btn btn-sm" onclick="limpiarFiltrosPres()">✕ Ver todos</button>'+
  '</div>';

  estados.forEach(function(est){
    var grupo=lista.filter(function(p){return p.estado===est;});
    if(!grupo.length) return;
    var total=grupo.reduce(function(a,p){return a+calcTotal(p);},0);
    h += '<div style="margin-bottom:12px">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'+
        '<span>'+presEstadoPill(est)+'<strong style="margin-left:8px">'+grupo.length+' presupuesto'+(grupo.length!==1?'s':'')+'</strong></span>'+
        '<span style="font-weight:700">$'+Math.round(total).toLocaleString('es-AR')+(tc>1?' / U$S '+(total/tc).toFixed(0):'')+'</span>'+
      '</div>'+
      '<table style="width:100%;border-collapse:collapse">'+
      '<thead><tr style="background:var(--surface2)"><th style="padding:5px 10px;font-size:10px">N°</th><th style="padding:5px 10px;font-size:10px">Cliente</th><th style="padding:5px 10px;font-size:10px">Línea</th><th style="padding:5px 10px;font-size:10px">Fecha</th><th style="padding:5px 10px;font-size:10px;text-align:right">Total</th></tr></thead>'+
      '<tbody>'+grupo.map(function(p){
        var tot=calcTotal(p);
        return '<tr style="border-bottom:1px solid var(--border)">'+
          '<td style="padding:5px 10px;font-family:monospace;font-size:11px">'+presNum(p)+'</td>'+
          '<td style="padding:5px 10px">'+p.nombre+'</td>'+
          '<td style="padding:5px 10px">'+presLineaPill(p)+'</td>'+
          '<td style="padding:5px 10px;font-size:11px">'+p.fecha+'</td>'+
          '<td style="padding:5px 10px;text-align:right;font-weight:700">$'+Math.round(tot).toLocaleString('es-AR')+'</td>'+
        '</tr>';
      }).join('')+'</tbody></table></div>';
  });

  if(!lista.length) h += '<div class="empty">Sin presupuestos en el período.</div>';
  reporteContainer('📄 Presupuestos por período', h);
}


function reporteUbicaciones(){
  // Agrupar componentes por ubicación
  var grupos = {};
  DB.componentes.forEach(function(c){
    var ubic = (c.ubicacion||'').trim();
    var key = ubic || '__sin_ubicacion__';
    if(!grupos[key]) grupos[key] = [];
    grupos[key].push(c);
  });

  // Ordenar ubicaciones alfabéticamente, sin-ubicación al final
  var keys = Object.keys(grupos).filter(function(k){return k!=='__sin_ubicacion__';}).sort();
  if(grupos['__sin_ubicacion__']) keys.push('__sin_ubicacion__');

  var html =
    // Barra de herramientas con toggle y búsqueda
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px">'+
      '<div style="display:flex;border:1px solid var(--border);border-radius:var(--r);overflow:hidden">'+
        '<button id="ubic-tab-cajas" class="btn" onclick="ubicToggle(\'cajas\')" style="border-radius:0;border:none;background:var(--brand);color:#fff;font-size:12px;padding:5px 14px">📦 Por caja</button>'+
        '<button id="ubic-tab-buscar" class="btn" onclick="ubicToggle(\'buscar\')" style="border-radius:0;border:none;background:transparent;font-size:12px;padding:5px 14px">🔍 Buscar componente</button>'+
      '</div>'+
      '<input id="ubic-q" type="text" placeholder="Buscar componente o caja..." oninput="ubicRender()" '+
        'style="flex:1;min-width:180px;padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface2);color:var(--text)">'+
      '<select id="ubic-area" onchange="ubicRender()" style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px">'+
        '<option value="">Todas las áreas</option>'+
        '<option>Fábrica</option><option>Mantenimiento</option><option>Instalacion</option>'+
      '</select>'+
    '</div>'+
    '<div id="ubic-body"></div>';

  reporteContainer('📦 Ubicaciones / Cajas', html);

  // Estado persistente en closures
  window._ubicMode = 'cajas';
  window._ubicGrupos = grupos;
  window._ubicKeys = keys;
  window.ubicToggle = function(mode){
    window._ubicMode = mode;
    var btnC = document.getElementById('ubic-tab-cajas');
    var btnB = document.getElementById('ubic-tab-buscar');
    if(btnC && btnB){
      btnC.style.background = mode==='cajas'?'var(--brand)':'transparent';
      btnC.style.color      = mode==='cajas'?'#fff':'';
      btnB.style.background = mode==='buscar'?'var(--brand)':'transparent';
      btnB.style.color      = mode==='buscar'?'#fff':'';
    }
    var qEl = document.getElementById('ubic-q');
    if(qEl) qEl.placeholder = mode==='cajas'?'Filtrar cajas...':'Buscar componente...';
    ubicRender();
  };
  window.ubicRender = function(){
    var q    = (document.getElementById('ubic-q')?document.getElementById('ubic-q').value||'':'').toLowerCase();
    var area = document.getElementById('ubic-area')?document.getElementById('ubic-area').value:'';
    var body = document.getElementById('ubic-body');
    if(!body) return;
    var mode = window._ubicMode;
    var grupos = window._ubicGrupos;
    var keys   = window._ubicKeys;

    if(mode==='buscar'){
      // ── VISTA BUSCAR ──────────────────────────────────────────────────
      if(!q){ body.innerHTML='<p style="color:var(--text2);font-size:12px;padding:8px 0">Escribí el nombre o código del componente que buscás.</p>'; return; }
      var results = DB.componentes.filter(function(c){
        return (c.desc+c.codigo+(c.categoria||'')).toLowerCase().includes(q)
          && (!area || c.area===area);
      });
      if(!results.length){ body.innerHTML='<p style="color:var(--text2);font-size:12px;padding:8px 0">Sin resultados para "'+q+'".</p>'; return; }
      var h='<table style="width:100%"><thead><tr>'+
        '<th>Código</th><th>Descripción</th><th>Ubicación</th><th>Área</th><th style="text-align:center">Stock</th><th style="text-align:center">Estado</th>'+
        '</tr></thead><tbody>';
      results.forEach(function(c){
        var qty = stockActual(c.id);
        var min = parseFloat(c.min)||0;
        var sc  = qty<=0?'var(--red)':qty<=min?'var(--amber)':'var(--green)';
        var eMat= c.estadoMat==='R'?'<span class="pill p-a">R</span>':'<span class="pill p-g">N</span>';
        var ubic= (c.ubicacion||'').trim()||'<span style="color:var(--text2);font-style:italic">Sin asignar</span>';
        h+='<tr>'+
          '<td style="font-family:monospace;font-size:11px">'+c.codigo+'</td>'+
          '<td><strong>'+c.desc+'</strong></td>'+
          '<td><strong style="color:var(--brand)">'+ubic+'</strong></td>'+
          '<td><span class="pill '+(c.area==='Mantenimiento'?'p-b':c.area==='Instalacion'?'p-a':'p-g')+'" style="font-size:10px">'+( c.area||'—')+'</span></td>'+
          '<td style="text-align:center;font-weight:700;color:'+sc+'">'+qty+' '+(c.unidad||'')+'</td>'+
          '<td style="text-align:center">'+eMat+'</td>'+
        '</tr>';
      });
      h+='</tbody></table>';
      body.innerHTML = h;

    } else {
      // ── VISTA CAJAS ───────────────────────────────────────────────────
      var html='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px">';
      var hayAlgo = false;

      keys.forEach(function(key){
        var comps = grupos[key];
        if(!comps) return;

        // Filtro área
        if(area) comps = comps.filter(function(c){return c.area===area;});
        // Filtro búsqueda por nombre de caja o componente
        if(q){
          var cajaMatch = key!=='__sin_ubicacion__' && key.toLowerCase().includes(q);
          if(!cajaMatch){
            comps = comps.filter(function(c){
              return (c.desc+c.codigo+(c.categoria||'')).toLowerCase().includes(q);
            });
          }
        }
        if(!comps.length) return;
        hayAlgo = true;

        var criticos = comps.filter(function(c){
          var qty=stockActual(c.id); return qty<=(parseFloat(c.min)||0);
        }).length;
        var sinStock = comps.filter(function(c){return stockActual(c.id)<=0;}).length;

        var esVacia = key==='__sin_ubicacion__';
        var titulo  = esVacia ? '⚠ Sin ubicación asignada' : '📦 '+key;
        var badgeColor = criticos>0?'var(--amber)':sinStock>0?'var(--red)':'var(--green)';
        var badgeText  = sinStock>0?sinStock+' sin stock':criticos>0?criticos+' crítico'+(criticos>1?'s':''):'OK';

        html+=
          '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);overflow:hidden">'+
            // Header de tarjeta
            '<div style="background:var(--surface2);padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border)">'+
              '<div style="font-weight:700;font-size:13px">'+titulo+'</div>'+
              '<div style="display:flex;gap:6px;align-items:center">'+
                '<span style="font-size:11px;color:var(--text2)">'+comps.length+' ítem'+(comps.length!==1?'s':'')+'</span>'+
                '<span style="font-size:10px;font-weight:700;color:'+badgeColor+'">'+badgeText+'</span>'+
              '</div>'+
            '</div>'+
            // Tabla interna
            '<table style="width:100%;border-collapse:collapse">'+
              '<thead><tr>'+
                '<th style="font-size:10px;padding:4px 8px;text-align:left;color:var(--text2);font-weight:600;border-bottom:1px solid var(--border)">Código</th>'+
                '<th style="font-size:10px;padding:4px 8px;text-align:left;color:var(--text2);font-weight:600;border-bottom:1px solid var(--border)">Descripción</th>'+
                '<th style="font-size:10px;padding:4px 8px;text-align:center;color:var(--text2);font-weight:600;border-bottom:1px solid var(--border)">Stock</th>'+
                '<th style="font-size:10px;padding:4px 8px;text-align:center;color:var(--text2);font-weight:600;border-bottom:1px solid var(--border)">Est.</th>'+
              '</tr></thead>'+
              '<tbody>'+
              comps.map(function(c, ri){
                var qty = stockActual(c.id);
                var min = parseFloat(c.min)||0;
                var sc  = qty<=0?'var(--red)':qty<=min?'var(--amber)':'var(--green)';
                var eMat= c.estadoMat==='R'?'<span class="pill p-a" style="font-size:9px;padding:1px 4px">R</span>':'<span class="pill p-g" style="font-size:9px;padding:1px 4px">N</span>';
                var bg  = ri%2===0?'':'background:var(--surface2)';
                return '<tr style="'+bg+'">'+
                  '<td style="font-family:monospace;font-size:10px;padding:4px 8px;color:var(--text2)">'+c.codigo+'</td>'+
                  '<td style="font-size:11px;padding:4px 8px">'+c.desc+'</td>'+
                  '<td style="font-size:12px;font-weight:700;text-align:center;padding:4px 8px;color:'+sc+'">'+qty+'<span style="font-size:9px;color:var(--text2);font-weight:400"> '+( c.unidad||'')+'</span></td>'+
                  '<td style="text-align:center;padding:4px 8px">'+eMat+'</td>'+
                '</tr>';
              }).join('')+
              '</tbody>'+
            '</table>'+
          '</div>';
      });

      if(!hayAlgo) html+='<p style="color:var(--text2);font-size:12px;padding:8px 0">Sin resultados.</p>';
      html+='</div>';
      body.innerHTML = html;
    }
  };

  // Render inicial
  window.ubicRender();
}

function reporteStockCritico(){
  const tc=(DB.config&&DB.config.tipoCambio)||1;
  const criticos=DB.componentes.filter(function(c){return stockActual(c.id)<=(parseFloat(c.min)||0);});
  if(!criticos.length){reporteContainer('⚠️ Stock crítico','<p style="color:var(--green)">✔ No hay componentes en stock crítico.</p>');return;}
  var h='<table><thead><tr><th>Código</th><th>Componente</th><th>Stock</th><th>Mínimo</th><th>Faltante</th><th>Valor rep. $</th><th>Valor rep. U$S</th></tr></thead><tbody>';
  criticos.forEach(function(c){
    const actual=stockActual(c.id);
    const faltante=Math.max(0,(c.min||0)-actual);
    const valor=faltante*(c.precio||0);
    h+='<tr><td style="font-family:monospace;font-size:10px">'+c.codigo+'</td><td>'+c.desc+'</td>'+
      '<td style="color:var(--red);font-weight:700">'+actual+'</td><td>'+(c.min||0)+'</td><td>'+faltante+'</td>'+
      '<td>'+formatMonto(valor,'ARS')+'</td><td>U$S '+(tc>0?(valor/tc).toFixed(0):0)+'</td></tr>';
  });
  h+='</tbody></table>';
  reporteContainer('⚠️ Stock crítico', h);
}

function reporteInventario(){
  const tc=(DB.config&&DB.config.tipoCambio)||1;
  const areas=['Fábrica','Mantenimiento','Instalacion'];
  var h='<table><thead><tr><th>Área</th><th>Componentes</th><th>Valor $</th><th>Valor U$S</th></tr></thead><tbody>';
  var totalVal=0;
  areas.forEach(function(area){
    const comps=DB.componentes.filter(function(c){return c.area===area;});
    const val=comps.reduce(function(a,c){return a+stockActual(c.id)*(c.precio||0);},0);
    totalVal+=val;
    h+='<tr><td>'+area+'</td><td>'+comps.length+'</td><td>'+formatMonto(val,'ARS')+'</td><td>U$S '+(tc>0?(val/tc).toFixed(0):0)+'</td></tr>';
  });
  const totalVal2=DB.componentes.reduce(function(a,c){return a+stockActual(c.id)*(c.precio||0);},0);
  h+='<tr style="font-weight:700"><td>TOTAL</td><td>'+DB.componentes.length+'</td><td>'+formatMonto(totalVal2,'ARS')+'</td><td>U$S '+(tc>0?(totalVal2/tc).toFixed(0):0)+'</td></tr>';
  h+='</tbody></table>';
  reporteContainer('📦 Inventario por área', h);
}

function reporteMovimientos(){
  const tc=(DB.config&&DB.config.tipoCambio)||1;
  const hoy=today();
  const hace30=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  const recientes=DB.movimientos.filter(function(m){return m.fecha>=hace30;});
  const entradas=recientes.filter(function(m){return m.tipo==='Entrada';});
  const salidas=recientes.filter(function(m){return m.tipo!=='Entrada';});
  const totalEnt=entradas.reduce(function(a,m){return a+(parseFloat(m.precio)||0)*(parseFloat(m.cant)||0);},0);
  const totalSal=salidas.reduce(function(a,m){return a+(parseFloat(m.precio)||0)*(parseFloat(m.cant)||0);},0);
  var h='<p style="font-size:12px;color:var(--text2);margin-bottom:12px">Últimos 30 días</p>';
  h+='<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">';
  h+='<div class="stat"><div class="stat-n green">'+entradas.length+'</div><div class="stat-l">Entradas</div></div>';
  h+='<div class="stat"><div class="stat-n red">'+salidas.length+'</div><div class="stat-l">Salidas</div></div>';
  h+='<div class="stat"><div class="stat-n">'+recientes.length+'</div><div class="stat-l">Total movs.</div></div>';
  h+='</div>';
  h+='<table><thead><tr><th>Tipo</th><th>Movimientos</th><th>Valor $</th><th>Valor U$S</th></tr></thead><tbody>';
  h+='<tr><td><span class="pill p-g">Entradas</span></td><td>'+entradas.length+'</td><td>'+formatMonto(totalEnt,'ARS')+'</td><td>U$S '+(tc>0?(totalEnt/tc).toFixed(0):0)+'</td></tr>';
  h+='<tr><td><span class="pill p-r">Salidas</span></td><td>'+salidas.length+'</td><td>'+formatMonto(totalSal,'ARS')+'</td><td>U$S '+(tc>0?(totalSal/tc).toFixed(0):0)+'</td></tr>';
  h+='</tbody></table>';
  reporteContainer('🔄 Movimientos (últimos 30 días)', h);
}

function reporteMantenimiento(){
  const hace90=new Date(Date.now()-90*86400000).toISOString().slice(0,10);
  const activos=DB.clientes.filter(function(c){return c.estado==='Activo';});
  const sinMant=activos.filter(function(c){
    if(!c.mant||!c.mant.length) return true;
    const ultimo=c.mant.map(function(m){return m.fecha;}).sort().pop();
    return ultimo<hace90;
  });
  var h='<p style="font-size:12px;color:var(--text2);margin-bottom:12px">Clientes activos sin mantenimiento en los últimos 90 días: <strong>'+sinMant.length+'</strong></p>';
  if(sinMant.length){
    h+='<table><thead><tr><th>Cliente</th><th>Barrio</th><th>Modelo</th><th>Último mant.</th></tr></thead><tbody>';
    sinMant.forEach(function(c){
      const ultimo=c.mant&&c.mant.length?c.mant.map(function(m){return m.fecha;}).sort().pop():'Nunca';
      h+='<tr><td><strong>'+c.nombre+'</strong></td><td>'+( c.barrio||'—')+'</td><td>'+mPill(c.modelo)+'</td><td>'+ultimo+'</td></tr>';
    });
    h+='</tbody></table>';
  }
  reporteContainer('🔧 Clientes sin mantenimiento', h);
}

function reporteOTA(){
  var fCliente = document.getElementById('rf-cliente')?document.getElementById('rf-cliente').value:'';
  var fVersion = document.getElementById('rf-version')?document.getElementById('rf-version').value:'';

  var clientes = DB.clientes.filter(function(c){
    return c.estado==='Activo' &&
      (!fCliente||c.nombre.toLowerCase().includes(fCliente.toLowerCase())) &&
      (!fVersion||( c.version||'').toLowerCase().includes(fVersion.toLowerCase()));
  }).sort(function(a,b){return (a.nombre||'').localeCompare(b.nombre||'');});

  var versiones = {};
  clientes.forEach(function(c){
    versiones[c.version||'Sin versión']=(versiones[c.version||'Sin versión']||0)+1;
  });

  var rows = clientes.map(function(c){
    return '<tr>'+
      '<td><strong>'+c.nombre+'</strong></td>'+
      '<td style="font-size:11px;color:var(--text2)">'+(c.lote||'')+(c.barrio?' · '+c.barrio:'')+'</td>'+
      '<td>'+mPill(c.modelo)+'</td>'+
      '<td style="font-family:monospace;font-weight:700">'+(c.version||'—')+'</td>'+
      '<td style="font-size:11px">'+(c.fecha||'—')+'</td>'+
    '</tr>';
  }).join('');

  var h = '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">'+
    '<input id="rf-cliente" value="'+fCliente+'" placeholder="Filtrar por cliente..." onchange="reporteOTA()" '+
    'style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)">'+
    '<input id="rf-version" value="'+fVersion+'" placeholder="Filtrar por versión..." onchange="reporteOTA()" '+
    'style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)">'+
  '</div>';

  if(!clientes.length){
    h += '<div class="empty">Sin resultados.</div>';
  } else {
    h += '<table><thead><tr><th>Cliente</th><th>Ubicación</th><th>Modelo</th><th>Firmware</th><th>Fecha inst.</th></tr></thead>'+
      '<tbody>'+rows+'</tbody></table>';
  }
  reporteContainer('📡 Firmware instalado por cliente', h);
}

function reporteInstalaciones(){
  var estados = ['Pendiente','En curso','Completada','Sin definir'];
  var clientes = DB.clientes.filter(function(c){return c.estado==='Activo';});

  // Filter buttons
  var btnsFiltro = estados.map(function(e){
    var cnt = clientes.filter(function(c){
      return e==='Sin definir'?!c.estadoInstalacion:(c.estadoInstalacion||'Sin definir')===e;
    }).length;
    return '<button data-est="'+e+'" class="btn btn-sm" style="margin-right:4px">'+e+' ('+cnt+')</button>';
  }).join('');

  var rows = clientes.map(function(c){
    var est = c.estadoInstalacion||'Sin definir';
    var color = est==='Completada'?'var(--green)':est==='En curso'?'var(--amber)':est==='Pendiente'?'var(--red)':'var(--text2)';
    return '<tr>'+
      '<td><strong>'+c.nombre+'</strong></td>'+
      '<td>'+(c.lote||'—')+'</td>'+
      '<td>'+(c.barrio||'—')+'</td>'+
      '<td>'+mPill(c.modelo)+'</td>'+
      '<td>'+(c.fecha||'—')+'</td>'+
      '<td style="font-weight:700;color:'+color+'">'+est+'</td>'+
      '<td style="font-size:11px;color:var(--text2);max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+(c.notas||'—')+'</td>'+
    '</tr>';
  }).join('');

  var h = '<div style="margin-bottom:10px">'+btnsFiltro+'</div>'+
    '<div id="inst-tabla">'+
    '<table><thead><tr>'+
      '<th>Cliente</th><th>Lote</th><th>Barrio</th><th>Modelo</th><th>Fecha inst.</th><th>Estado</th><th>Notas</th>'+
    '</tr></thead><tbody id="inst-body">'+rows+'</tbody></table></div>';

  reporteContainer('🔧 Estado de instalaciones', h);
  // Attach filter button handlers
  document.querySelectorAll('[data-est]').forEach(function(btn){
    btn.onclick = function(){ reporteInstalaciones_filtro(this.dataset.est); };
  });
}

function reporteInstalaciones_filtro(estado){
  var clientes = DB.clientes.filter(function(c){return c.estado==='Activo';});
  var filtered = estado==='Sin definir'
    ? clientes.filter(function(c){return !c.estadoInstalacion;})
    : clientes.filter(function(c){return (c.estadoInstalacion||'Sin definir')===estado;});

  var rows = filtered.map(function(c){
    var est = c.estadoInstalacion||'Sin definir';
    var color = est==='Completada'?'var(--green)':est==='En curso'?'var(--amber)':est==='Pendiente'?'var(--red)':'var(--text2)';
    return '<tr>'+
      '<td><strong>'+c.nombre+'</strong></td>'+
      '<td>'+(c.lote||'—')+'</td>'+
      '<td>'+(c.barrio||'—')+'</td>'+
      '<td>'+mPill(c.modelo)+'</td>'+
      '<td>'+(c.fecha||'—')+'</td>'+
      '<td style="font-weight:700;color:'+color+'">'+est+'</td>'+
      '<td style="font-size:11px;color:var(--text2)">'+(c.notas||'—')+'</td>'+
    '</tr>';
  }).join('') || '<tr><td colspan="7" class="empty">Sin clientes en este estado.</td></tr>';

  var tb = document.getElementById('inst-body');
  if(tb) tb.innerHTML = rows;
}

// REPORTE: Vencimientos de garantía ========================
function reporteVencimientos(){
  var hoy = today();
  var clientes = DB.clientes.filter(function(c){return c.estado==='Activo';});

  var items = [];
  clientes.forEach(function(c){
    if(c.equipo && c.equipo.ups_gar_vence){
      var dias = Math.round((new Date(c.equipo.ups_gar_vence)-new Date())/86400000);
      items.push({cliente:c.nombre, lote:c.lote||'', barrio:c.barrio||'', equipo:'Actuador '+( c.equipo.ups_marca||'')+' '+(c.equipo.ups_modelo||''), vence:c.equipo.ups_gar_vence, dias:dias});
    }
  });

  items.sort(function(a,b){return a.dias-b.dias;});

  if(!items.length){
    reporteContainer('⏰ Vencimientos de garantía','<div class="empty">No hay garantías registradas.</div>');
    return;
  }

  var rows = items.map(function(i){
    var color = i.dias<0?'var(--red)':i.dias<=30?'#E65100':i.dias<=90?'var(--amber)':'var(--green)';
    var label = i.dias<0?'Vencida hace '+Math.abs(i.dias)+' días':i.dias===0?'Vence hoy':'Vence en '+i.dias+' días';
    return '<tr>'+
      '<td><strong>'+i.cliente+'</strong></td>'+
      '<td>'+(i.lote)+(i.barrio?' · '+i.barrio:'')+'</td>'+
      '<td>'+i.equipo+'</td>'+
      '<td>'+i.vence+'</td>'+
      '<td style="font-weight:700;color:'+color+'">'+label+'</td>'+
    '</tr>';
  }).join('');

  var vencidas = items.filter(function(i){return i.dias<0;}).length;
  var prox30 = items.filter(function(i){return i.dias>=0&&i.dias<=30;}).length;
  var prox90 = items.filter(function(i){return i.dias>30&&i.dias<=90;}).length;

  var h = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">'+
    '<div class="stat"><div class="stat-n red">'+vencidas+'</div><div class="stat-l">Vencidas</div></div>'+
    '<div class="stat"><div class="stat-n amber">'+prox30+'</div><div class="stat-l">Vencen en 30 días</div></div>'+
    '<div class="stat"><div class="stat-n">'+prox90+'</div><div class="stat-l">Vencen en 31-90 días</div></div>'+
  '</div>'+
  '<table><thead><tr>'+
    '<th>Cliente</th><th>Ubicación</th><th>Equipo</th><th>Vence</th><th>Estado</th>'+
  '</tr></thead><tbody>'+rows+'</tbody></table>';

  reporteContainer('⏰ Vencimientos de garantía', h);
}

// REPORTE: Historial de presupuestos ========================
function reporteHistorialPres(){
  var pres = DB.presupuestos.filter(function(p){return p.historial&&p.historial.length;});

  if(!pres.length){
    reporteContainer('📋 Historial de presupuestos','<div class="empty">Sin historial registrado. Los cambios de estado se registran a partir de ahora.</div>');
    return;
  }

  var h = '';
  pres.forEach(function(p){
    h += '<div class="card" style="margin-bottom:10px">'+
      '<div class="ch"><div class="ct">'+presNum(p)+' — '+p.nombre+'</div>'+
      '<div>'+presEstadoPill(p.estado)+'</div></div>'+
      '<div class="card-body">'+
        '<div style="display:flex;align-items:center;gap:0;flex-wrap:wrap">';

    // Timeline
    var steps = [{fecha:p.fecha||'',de:'',a:'Borrador'}].concat(p.historial||[]);
    steps.forEach(function(s,i){
      var color = s.a==='Aprobado'?'var(--green)':s.a==='Rechazado'?'var(--red)':s.a==='Enviado'?'var(--blue)':'var(--text2)';
      h += '<div style="display:flex;align-items:center;gap:6px">'+
        '<div style="text-align:center">'+
          '<div style="width:28px;height:28px;border-radius:50%;background:'+color+';color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;margin:0 auto 3px">'+( i+1)+'</div>'+
          '<div style="font-size:10px;font-weight:700;color:'+color+'">'+s.a+'</div>'+
          '<div style="font-size:9px;color:var(--text2)">'+s.fecha+'</div>'+
        '</div>'+
        (i<steps.length-1?'<div style="width:30px;height:2px;background:var(--border);margin:0 2px"></div>':'');
    });

    h += '</div></div></div>';
  });

  reporteContainer('📋 Historial de presupuestos', h);
}


function reporteMantenimientos(){
  var hoy = today();
  var tc = (DB.config&&DB.config.tipoCambio)||1;

  // Build full list of mantenimientos across all clients
  var todos = [];
  DB.clientes.forEach(function(c){
    if(!c.mant||!c.mant.length) return;
    c.mant.forEach(function(m){
      todos.push({
        cliente: c.nombre,
        lote: c.lote||'',
        barrio: c.barrio||'',
        modelo: c.modelo||'AquaOne',
        fecha: m.fecha||'',
        tipo: m.tipo||'—',
        motivo: m.motivo||'—',
        falla: m.falla||'—',
        solucion: m.reparacion||'—',
        garantia: m.garantia||'No',
        costo: parseFloat(m.costo)||0,
        tecnico: m.tecnico||'—'
      });
    });
  });

  if(!todos.length){
    reporteContainer('🔧 Historial de mantenimientos','<div class="empty">Sin registros de mantenimiento.</div>');
    return;
  }

  // Get current filter values if they exist
  var fCliente = document.getElementById('rm-cliente')?document.getElementById('rm-cliente').value:'';
  var fTipo = document.getElementById('rm-tipo')?document.getElementById('rm-tipo').value:'';
  var fDesde = document.getElementById('rm-desde')?document.getElementById('rm-desde').value:'';
  var fHasta = document.getElementById('rm-hasta')?document.getElementById('rm-hasta').value:'';
  var fOrden = document.getElementById('rm-orden')?document.getElementById('rm-orden').value:'fecha-desc';
  var fMotivo = document.getElementById('rm-motivo')?document.getElementById('rm-motivo').value:'';
  var fFalla = document.getElementById('rm-falla')?document.getElementById('rm-falla').value:'';
  var fReparacion = document.getElementById('rm-reparacion')?document.getElementById('rm-reparacion').value:'';

  var lista = todos.filter(function(m){
    return (!fCliente||m.cliente.toLowerCase().includes(fCliente.toLowerCase())) &&
           (!fTipo||m.tipo===fTipo) &&
           (!fMotivo||m.motivo.toLowerCase().includes(fMotivo.toLowerCase())) &&
           (!fFalla||m.falla.toLowerCase().includes(fFalla.toLowerCase())) &&
           (!fReparacion||m.solucion.toLowerCase().includes(fReparacion.toLowerCase())) &&
           (!fDesde||m.fecha>=fDesde) &&
           (!fHasta||m.fecha<=fHasta);
  });

  // Sort
  lista.sort(function(a,b){
    if(fOrden==='fecha-desc') return a.fecha>b.fecha?-1:1;
    if(fOrden==='fecha-asc') return a.fecha>b.fecha?1:-1;
    if(fOrden==='cliente') return a.cliente.localeCompare(b.cliente);
    if(fOrden==='tipo') return a.tipo.localeCompare(b.tipo);
    return 0;
  });

  var totalCosto = lista.reduce(function(a,m){return a+m.costo;},0);
  var enGarantia = lista.filter(function(m){return m.garantia==='Sí';}).length;

  // Stats
  var h = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px">'+
    '<div class="stat"><div class="stat-n">'+lista.length+'</div><div class="stat-l">Visitas en período</div></div>'+
    '<div class="stat"><div class="stat-n green">'+enGarantia+'</div><div class="stat-l">En garantía</div></div>'+
    '<div class="stat"><div class="stat-n blue">$'+Math.round(totalCosto).toLocaleString('es-AR')+'</div><div class="stat-l">Costo total</div></div>'+
  '</div>';

  // Filters
  var clientes = [...new Set(todos.map(function(m){return m.cliente;}))].sort();
  var tipos = [...new Set(todos.map(function(m){return m.tipo;}))].sort();

  h += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">'+
    '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Cliente</label>'+
      '<input id="rm-cliente" value="'+fCliente+'" placeholder="Filtrar por cliente..." onchange="reporteMantenimientos()" '+
      'style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)"></div>'+
    '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Tipo</label>'+
      '<select id="rm-tipo" onchange="reporteMantenimientos()" style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)">'+
        '<option value="">Todos</option>'+[...tipos].sort(function(a,b){return (a||'').localeCompare(b||'');}).map(function(t){return '<option'+(t===fTipo?' selected':'')+'>'+t+'</option>';}).join('')+
      '</select></div>'+
    '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Motivo</label>'+
      '<input id="rm-motivo" value="'+fMotivo+'" placeholder="Filtrar motivo..." onchange="reporteMantenimientos()" '+
      'style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)"></div>'+
    '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Falla</label>'+
      '<input id="rm-falla" value="'+fFalla+'" placeholder="Filtrar falla..." onchange="reporteMantenimientos()" '+
      'style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)"></div>'+
    '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Reparación</label>'+
      '<input id="rm-reparacion" value="'+fReparacion+'" placeholder="Filtrar reparación..." onchange="reporteMantenimientos()" '+
      'style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)"></div>'+
    '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Desde</label>'+
      '<input id="rm-desde" type="date" value="'+fDesde+'" onchange="reporteMantenimientos()" '+
      'style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)"></div>'+
    '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Hasta</label>'+
      '<input id="rm-hasta" type="date" value="'+fHasta+'" onchange="reporteMantenimientos()" '+
      'style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)"></div>'+
    '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Ordenar por</label>'+
      '<select id="rm-orden" onchange="reporteMantenimientos()" style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)">'+
        '<option value="fecha-desc"'+(fOrden==='fecha-desc'?' selected':'')+'>Fecha ↓</option>'+
        '<option value="fecha-asc"'+(fOrden==='fecha-asc'?' selected':'')+'>Fecha ↑</option>'+
        '<option value="cliente"'+(fOrden==='cliente'?' selected':'')+'>Cliente A-Z</option>'+
        '<option value="tipo"'+(fOrden==='tipo'?' selected':'')+'>Tipo</option>'+
      '</select></div>'+
    '<button class="btn btn-sm" onclick="pdfReporteMantenimientos()">🖨️ PDF</button>'+
  '</div>';

  if(!lista.length){
    h += '<div class="empty">Sin registros para los filtros aplicados.</div>';
    reporteContainer('🔧 Historial de mantenimientos', h);
    return;
  }

  h += '<table><thead><tr>'+
    '<th>Fecha</th><th>Cliente</th><th>Modelo</th><th>Tipo</th>'+
    '<th>Motivo</th><th>Falla</th><th>Reparación</th><th>Garantía</th>'+
    '<th style="text-align:right">Costo $</th><th>Técnico</th>'+
  '</tr></thead><tbody>';

  lista.forEach(function(m){
    h += '<tr>'+
      '<td style="font-size:11px">'+m.fecha+'</td>'+
      '<td><strong>'+m.cliente+'</strong><br><span style="font-size:10px;color:var(--text2)">'+m.lote+(m.barrio?' · '+m.barrio:'')+'</span></td>'+
      '<td>'+mPill(m.modelo)+'</td>'+
      '<td><span class="pill p-b">'+m.tipo+'</span></td>'+
      '<td style="font-size:11px">'+m.motivo+'</td>'+
      '<td style="font-size:11px">'+m.falla+'</td>'+
      '<td style="font-size:11px">'+m.solucion+'</td>'+
      '<td style="text-align:center">'+(m.garantia==='Sí'?'<span style="color:var(--green);font-weight:700">✔</span>':'—')+'</td>'+
      '<td style="text-align:right;font-weight:700">$'+Math.round(m.costo).toLocaleString('es-AR')+'</td>'+
      '<td style="font-size:11px">'+m.tecnico+'</td>'+
    '</tr>';
  });

  h += '</tbody></table>';
  reporteContainer('🔧 Historial de mantenimientos', h);
}

function pdfReporteMantenimientos(){
  var empresa=(DB.config&&DB.config.empresa)||'Riego Adaptativo';
  var todos=[];
  DB.clientes.forEach(function(c){
    if(!c.mant||!c.mant.length) return;
    c.mant.forEach(function(m){
      todos.push({cliente:c.nombre,lote:c.lote||'',modelo:c.modelo||'',
        fecha:m.fecha||'',tipo:m.tipo||'',motivo:m.motivo||'',
        solucion:m.reparacion||'',garantia:m.garantia||'No',
        costo:parseFloat(m.costo)||0,tecnico:m.tecnico||''});
    });
  });
  todos.sort(function(a,b){return a.fecha>b.fecha?-1:1;});
  var total=todos.reduce(function(a,m){return a+m.costo;},0);
  var rows=todos.map(function(m){
    return '<tr><td>'+m.fecha+'</td><td>'+m.cliente+'</td><td>'+m.modelo+'</td>'+
      '<td>'+m.tipo+'</td><td>'+m.motivo+'</td><td>'+m.solucion+'</td>'+
      '<td style="text-align:center">'+(m.garantia==='Sí'?'✔':'—')+'</td>'+
      '<td style="text-align:right">$'+Math.round(m.costo).toLocaleString('es-AR')+'</td>'+
      '<td>'+m.tecnico+'</td></tr>';
  }).join('');
  var css='*{box-sizing:border-box;margin:0;padding:0}body{font-family:Segoe UI,Arial,sans-serif;padding:20px;font-size:11px}'+
    'h1{font-size:15px;color:#256282;margin-bottom:2px}.meta{color:#666;font-size:10px;margin-bottom:12px}'+
    'table{width:100%;border-collapse:collapse}th{background:#256282;color:#fff;padding:6px 8px;font-size:10px;text-align:left}'+
    'td{padding:5px 8px;border-bottom:1px solid #eee}tfoot td{background:#222;color:#fff;font-weight:700}'+
    '.btn{position:fixed;top:12px;right:12px;background:#256282;color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer}'+
    '@media print{.btn{display:none}}';
  var w=window.open('','_blank');
  w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Mantenimientos</title><style>'+css+'</style></head><body>'+
    '<button class="btn" onclick="window.print()">🖨️ Imprimir</button>'+
    '<h1>HISTORIAL DE MANTENIMIENTOS</h1><div class="meta">'+empresa+' · '+today()+'</div>'+
    '<table><thead><tr><th>Fecha</th><th>Cliente</th><th>Modelo</th><th>Tipo</th><th>Motivo</th><th>Falla</th><th>Reparación</th><th>Gtía</th><th>Costo</th><th>Técnico</th></tr></thead>'+
    '<tbody>'+rows+'</tbody>'+
    '<tfoot><tr><td colspan="7" style="padding:7px 8px;text-align:right">TOTAL</td>'+
    '<td style="padding:7px 8px;text-align:right">$'+Math.round(total).toLocaleString('es-AR')+'</td><td></td></tr></tfoot>'+
    '</table></body></html>');
  w.document.close();
}

function reportePendientes(){
  var fCliente = document.getElementById('rp-cliente')?document.getElementById('rp-cliente').value:'';
  var hace15=new Date(Date.now()-15*86400000).toISOString().slice(0,10);
  var lista=DB.presupuestos.filter(function(p){
    return p.estado==='Enviado' && p.fecha < hace15 &&
      (!fCliente||(p.nombre||'').toLowerCase().includes(fCliente.toLowerCase()));
  }).sort(function(a,b){return a.fecha>b.fecha?1:-1;});

  var h = '<div style="display:flex;gap:8px;margin-bottom:12px">'+
    '<input id="rp-cliente" value="'+fCliente+'" placeholder="Filtrar por cliente..." onchange="reportePendientes()" '+
    'style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)">'+
  '</div>';

  if(!lista.length){
    h += '<div class="empty">Sin presupuestos enviados sin respuesta.</div>';
  } else {
    h += '<table><thead><tr><th>N°</th><th>Cliente</th><th>Línea</th><th>Fecha envío</th><th>Días sin respuesta</th></tr></thead><tbody>';
    lista.forEach(function(p){
      var dias=Math.round((new Date()-new Date(p.fecha))/86400000);
      h += '<tr>'+
        '<td style="font-family:monospace">'+presNum(p)+'</td>'+
        '<td>'+p.nombre+'</td>'+
        '<td>'+presLineaPill(p)+'</td>'+
        '<td>'+p.fecha+'</td>'+
        '<td style="font-weight:700;color:'+(dias>30?'var(--red)':'var(--amber)')+'">'+dias+' días</td>'+
      '</tr>';
    });
    h += '</tbody></table>';
  }
  reporteContainer('⏳ Presupuestos sin respuesta', h);
}

function renderReportes(){
  var el = document.getElementById('reportes-body');
  if(!el) return;

  var hoy = today();
  var hace90 = new Date(Date.now()-90*86400000).toISOString().slice(0,10);

  // 1. Clientes por modelo
  var modelos = ['AquaOne','AquaDuo','AquaTrio','AquaPro','AquaMax'];
  var porModelo = {};
  modelos.forEach(function(m){ porModelo[m]=0; });
  DB.clientes.filter(function(c){return c.estado==='Activo';}).forEach(function(c){
    if(porModelo[c.modelo]!==undefined) porModelo[c.modelo]++;
  });

  // 2. Presupuestos stats
  var pres = DB.presupuestos;
  var presTotal = pres.length;
  var presAprobados = pres.filter(function(p){return p.estado==='Aprobado';}).length;
  var presRechazados = pres.filter(function(p){return p.estado==='Rechazado';}).length;
  var presEnviados = pres.filter(function(p){return p.estado==='Enviado';}).length;
  var tasa = presTotal>0?Math.round((presAprobados/presTotal)*100):0;
  var tc = (DB.config&&DB.config.tipoCambio)||1;

  // 3. Stock critico
  var criticos = DB.componentes.filter(function(c){
    var qty = stockActual(c.id);
    return qty <= (parseFloat(c.min)||0);
  });
  var valorReposicion = criticos.reduce(function(a,c){
    var faltante = Math.max(0,(parseFloat(c.min)||0)-stockActual(c.id));
    return a + faltante*(parseFloat(c.precio)||0);
  },0);

  // 4. Valor inventario por area
  var invAreas = {Fabrica:0,Mantenimiento:0,Instalacion:0};
  DB.componentes.forEach(function(c){
    var area = c.area||'Fabrica';
    var val = stockActual(c.id)*(parseFloat(c.precio)||0);
    if(invAreas[area]!==undefined) invAreas[area]+=val;
  });

  // 5. Clientes sin mantenimiento en 90 dias
  var sinMant = DB.clientes.filter(function(c){
    if(c.estado!=='Activo') return false;
    if(!c.mant||!c.mant.length) return true;
    var ultima = c.mant.map(function(m){return m.fecha;}).sort().reverse()[0];
    return ultima < hace90;
  }).length;

  // 6. Presupuestos enviados sin respuesta hace mas de 15 dias
  var hace15 = new Date(Date.now()-15*86400000).toISOString().slice(0,10);
  var sinRespuesta = pres.filter(function(p){
    return p.estado==='Enviado' && p.fecha < hace15;
  }).length;

  // 7. Versiones firmware
  var versiones = {};
  DB.clientes.filter(function(c){return c.estado==='Activo'&&c.version;}).forEach(function(c){
    versiones[c.version] = (versiones[c.version]||0)+1;
  });

  // 8. Movimientos del mes
  var mes = hoy.slice(0,7);
  var movsEnt = DB.movimientos.filter(function(m){return m.tipo==='Entrada'&&m.fecha&&m.fecha.slice(0,7)===mes;});
  var movsSal = DB.movimientos.filter(function(m){return m.tipo!=='Entrada'&&m.fecha&&m.fecha.slice(0,7)===mes;});
  var totalEntradas = movsEnt.reduce(function(a,m){return a+(parseFloat(m.cant)||0)*(parseFloat(m.precio)||0);},0);

  var h = '';

  // Stats generales
  h += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">';
  h += stat(DB.clientes.filter(function(c){return c.estado==='Activo';}).length, 'Clientes activos', 'green');
  h += stat(presAprobados, 'Presupuestos aprobados', 'blue');
  h += stat(criticos.length, 'Stock crítico', 'red');
  h += stat(tasa+'%', 'Tasa conversión', 'amber');
  h += '</div>';

  // Clientes por modelo
  // Clientes list with model filter
  var fModelo = document.getElementById('rep-modelo')?document.getElementById('rep-modelo').value:'';
  var clientesActivos = DB.clientes.filter(function(c){
    return c.estado==='Activo' && (!fModelo||c.modelo===fModelo);
  }).sort(function(a,b){return (a.modelo+a.nombre).localeCompare(b.modelo+b.nombre);});

  h += '<div class="card" style="margin-bottom:12px">';
  h += '<div class="ch"><div class="ct">👥 Clientes activos por modelo</div>';
  h += '<select id="rep-modelo" onchange="renderReportes()" style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)">'+
    '<option value="">Todos los modelos</option>'+
    modelos.map(function(m){return '<option value="'+m+'"'+(m===fModelo?' selected':'')+'>'+m+'</option>';}).join('')+
  '</select></div>';
  h += '<div class="card-body">';
  h += '<table style="width:100%;border-collapse:collapse">';
  h += '<thead><tr style="background:var(--surface2)"><th style="padding:6px 10px;font-size:11px;text-align:left">Cliente</th><th style="padding:6px 10px;font-size:11px;text-align:left">Ubicación</th><th style="padding:6px 10px;font-size:11px;text-align:left">Modelo</th><th style="padding:6px 10px;font-size:11px">Inst.</th></tr></thead><tbody>';
  clientesActivos.forEach(function(c){
    h += '<tr style="border-bottom:1px solid var(--border)">'+
      '<td style="padding:5px 10px;font-size:11px"><strong>'+c.nombre+'</strong></td>'+
      '<td style="padding:5px 10px;font-size:11px;color:var(--text2)">'+(c.lote||'')+(c.barrio?' · '+c.barrio:'')+'</td>'+
      '<td style="padding:5px 10px">'+mPill(c.modelo)+'</td>'+
      '<td style="padding:5px 10px;font-size:11px">'+(c.fecha||'—')+'</td>'+
    '</tr>';
  });
  h += '</tbody></table></div></div>';

  // Presupuestos
  h += '<div class="card"><div class="ch"><div class="ct">📄 Presupuestos</div></div><div class="card-body">';
  h += '<table style="width:100%;border-collapse:collapse">';
  h += rRow('Total emitidos', presTotal);
  h += rRow('Aprobados', presAprobados, 'green');
  h += rRow('Enviados sin respuesta (+15 días)', sinRespuesta, sinRespuesta>0?'red':'');
  h += rRow('Rechazados', presRechazados, presRechazados>0?'red':'');
  h += rRow('Tasa de conversión', tasa+'%', tasa>=50?'green':'amber');
  h += '</table></div></div>';
  h += '</div>';

  // Stock critico
  h += '<div class="card" style="margin-bottom:12px"><div class="ch"><div class="ct">⚠️ Stock crítico</div></div><div class="card-body">';
  if(criticos.length===0){
    h += '<div class="empty">Sin componentes bajo mínimo ✔</div>';
  } else {
    h += '<table style="width:100%;border-collapse:collapse"><thead><tr style="background:var(--surface2)"><th style="padding:6px 10px;text-align:left;font-size:11px">Componente</th><th style="padding:6px 10px;font-size:11px">Área</th><th style="padding:6px 10px;font-size:11px;text-align:center">Stock</th><th style="padding:6px 10px;font-size:11px;text-align:center">Mínimo</th><th style="padding:6px 10px;font-size:11px;text-align:right">Reposición est.</th></tr></thead><tbody>';
    criticos.forEach(function(c){
      var qty=stockActual(c.id);
      var falt=Math.max(0,(parseFloat(c.min)||0)-qty);
      h += '<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px 10px">'+c.desc+'</td><td style="padding:6px 10px">'+( c.area||'—')+'</td><td style="padding:6px 10px;text-align:center;color:var(--red);font-weight:700">'+qty+'</td><td style="padding:6px 10px;text-align:center">'+( c.min||0)+'</td><td style="padding:6px 10px;text-align:right">$'+Math.round(falt*(parseFloat(c.precio)||0)).toLocaleString('es-AR')+'</td></tr>';
    });
    h += '</tbody></table>';
    h += '<div style="padding:10px;font-size:12px;color:var(--text2)">Valor total estimado de reposición: <strong>$'+Math.round(valorReposicion).toLocaleString('es-AR')+'</strong>';
    if(tc>1) h += ' / <strong>U$S '+(valorReposicion/tc).toFixed(0)+'</strong>';
    h += '</div>';
  }
  h += '</div></div>';

  // Valor inventario por area
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">';
  h += '<div class="card"><div class="ch"><div class="ct">📦 Inventario por área</div></div><div class="card-body">';
  h += '<table style="width:100%;border-collapse:collapse">';
  Object.entries(invAreas).forEach(function(entry){
    h += rRow(entry[0], '$'+Math.round(entry[1]).toLocaleString('es-AR'));
  });
  h += rRow('TOTAL', '$'+Math.round(Object.values(invAreas).reduce(function(a,v){return a+v;},0)).toLocaleString('es-AR'), 'blue');
  h += '</table></div></div>';

  // Clientes sin mantenimiento
  h += '<div class="card"><div class="ch"><div class="ct">🔧 Mantenimiento</div></div><div class="card-body">';
  h += '<table style="width:100%;border-collapse:collapse">';
  h += rRow('Sin mantenimiento en 90 días', sinMant, sinMant>0?'amber':'green');
  h += rRow('Movimientos de stock este mes', movsEnt.length+' entradas / '+movsSal.length+' salidas');
  h += rRow('Valor entradas del mes', '$'+Math.round(totalEntradas).toLocaleString('es-AR'));
  h += '</table></div></div>';
  h += '</div>';

  // Versiones firmware
  h += '<div class="card"><div class="ch"><div class="ct">🔄 Versiones de firmware instaladas</div></div><div class="card-body">';
  var vkeys = Object.keys(versiones).sort().reverse();
  if(vkeys.length===0){
    h += '<div class="empty">Sin datos de versión registrados</div>';
  } else {
    h += '<table style="width:100%;border-collapse:collapse">';
    vkeys.forEach(function(v){
      h += rRow(v, versiones[v]+' cliente'+(versiones[v]!==1?'s':''));
    });
    h += '</table>';
  }
  h += '</div></div>';

  // 9. Vencimientos de garantía próximos 90 días
  var hoy2 = today();
  var en90 = new Date(Date.now()+90*86400000).toISOString().slice(0,10);
  var vencProx = DB.clientes.filter(function(c){
    return c.estado==='Activo' && c.equipo && c.equipo.ups_gar_vence &&
           c.equipo.ups_gar_vence >= hoy2 && c.equipo.ups_gar_vence <= en90;
  });

  if(vencProx.length){
    h += '<div class="card" style="margin-bottom:12px;border-left:3px solid #E65100"><div class="ch"><div class="ct">⏰ Garantías UPS por vencer (90 días)</div></div><div class="card-body">';
    h += '<table style="width:100%;border-collapse:collapse">';
    vencProx.forEach(function(c){
      var dias=Math.round((new Date(c.equipo.ups_gar_vence)-new Date())/86400000);
      h += '<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px 10px">'+c.nombre+'</td>'+
        '<td style="padding:6px 10px;font-size:11px">'+c.lote+(c.barrio?' · '+c.barrio:'')+'</td>'+
        '<td style="padding:6px 10px;font-weight:700;color:#E65100">'+c.equipo.ups_gar_vence+' ('+dias+' días)</td></tr>';
    });
    h += '</table></div></div>';
  }

  el.innerHTML = h;
}

function stat(val, label, color){
  return '<div class="stat"><div class="stat-n '+(color||'')+'" style="font-size:22px">'+val+'</div><div class="stat-l">'+label+'</div></div>';
}

function rRow(label, val, color){
  return '<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px 10px;font-size:12px">'+label+'</td><td style="padding:6px 10px;font-weight:700;text-align:right;color:var(--'+(color||'text')+')">'+val+'</td></tr>';
}


// PROVEEDORES ===============================================
function renderProveedores(){
  var el=document.getElementById('prov-body');
  if(!el) return;
  var h='<div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:10px">'+
    '<button class="btn btn-p" onclick="modalProveedor(-1)">➕ Nuevo proveedor</button>'+
    '<button class="btn btn-sm" onclick="pdfProveedores()">🖨️ PDF</button>'+
  '</div>';
  if(!DB.proveedores.length){
    h+='<div class="empty">Sin proveedores registrados.</div>';
    el.innerHTML=h; return;
  }
  h+='<table><thead><tr><th>Empresa</th><th>Contacto</th><th>Teléfono</th><th>Email</th><th>Rubro</th><th>Condiciones</th><th></th></tr></thead><tbody>';
  DB.proveedores.forEach(function(p,i){
    h+='<tr>'+
      '<td><strong>'+p.empresa+'</strong></td>'+
      '<td>'+(p.contacto||'—')+'</td>'+
      '<td>'+(p.tel||'—')+'</td>'+
      '<td>'+(p.email||'—')+'</td>'+'<td>'+(p.web||'—')+'</td>'+
      '<td>'+(p.rubro||'—')+'</td>'+
      '<td style="font-size:11px">'+(p.condiciones||'—')+'</td>'+
      '<td style="display:flex;gap:4px">'+
        '<button class="btn btn-sm" onclick="modalProveedor('+i+')">✏️</button>'+
        '<button class="btn btn-sm btn-p" onclick="modalOrdenDesdeProveedor('+p.id+')" title="Nueva OC">🛒</button>'+
        '<button class="btn btn-sm" style="color:var(--red)" onclick="borrarProveedor('+p.id+')">🗑️</button>'+
      '</td>'+
    '</tr>';
  });
  h+='</tbody></table>';
  el.innerHTML=h;
}

function modalProveedor(idx){
  var p=idx>=0?DB.proveedores[idx]:{};
  openModal(idx>=0?'Editar proveedor':'Nuevo proveedor',
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
    '<div class="fg"><label>Empresa *</label><input id="pv-emp" value="'+(p.empresa||'')+'"></div>'+
    '<div class="fg"><label>Rubro</label><input id="pv-rub" value="'+(p.rubro||'')+'" placeholder="Ej: Electrónica, Gabinetes..."></div>'+
    '<div class="fg"><label>Contacto</label><input id="pv-con" value="'+(p.contacto||'')+'"></div>'+
    '<div class="fg"><label>Teléfono</label><input id="pv-tel" value="'+(p.tel||'')+'"></div>'+
    '<div class="fg"><label>Email</label><input id="pv-email" type="email" value="'+(p.email||'')+'"></div>'+
    '<div class="fg"><label>Dirección</label><input id="pv-dir" value="'+(p.dir||'')+'"></div>'+
    '<div class="fg"><label>Sitio web</label><input id="pv-web" value="'+(p.web||'')+'" placeholder="www.proveedor.com"></div>'+
    '<div class="fg" style="grid-column:1/-1"><label>Condiciones comerciales</label><input id="pv-cond" value="'+(p.condiciones||'')+'" placeholder="Ej: 30 días, pago con transferencia..."></div>'+
    '<div class="fg" style="grid-column:1/-1"><label>Observaciones</label><textarea id="pv-obs" style="min-height:50px;padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%;font-family:inherit">'+(p.obs||'')+'</textarea></div>'+
    '</div>',
    function(){
      var emp=document.getElementById('pv-emp').value.trim();
      if(!emp){alert('El nombre de la empresa es obligatorio.');return false;}
      var obj={
        id:idx>=0?p.id:DB.nid++,
        empresa:emp,
        rubro:document.getElementById('pv-rub').value,
        contacto:document.getElementById('pv-con').value,
        tel:document.getElementById('pv-tel').value,
        email:document.getElementById('pv-email').value,
        dir:document.getElementById('pv-dir').value,
        condiciones:document.getElementById('pv-cond').value,
        obs:document.getElementById('pv-obs').value,
        web:document.getElementById('pv-web').value
      };
      if(idx>=0) DB.proveedores[idx]=obj;
      else DB.proveedores.push(obj);
      save(); renderProveedores(); return true;
    });
}

function borrarProveedor(id){
  if(!confirm('¿Eliminar este proveedor?')) return;
  DB.proveedores=DB.proveedores.filter(function(p){return p.id!==id;});
  save(); renderProveedores();
}

function modalOrdenDesdeProveedor(provId){
  var prov=DB.proveedores.find(function(p){return p.id===provId;});
  if(!prov) return;
  var compOpts=[...DB.componentes].sort(function(a,b){var sa=(a.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();var sb=(b.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();return sa.localeCompare(sb,'es');}).map(function(c){
    return '<option value="'+c.id+'">'+c.codigo+' — '+c.desc+'</option>';
  }).join('');
  openModal('Nueva OC — '+prov.empresa,
    '<div id="orden-items-pv"><div class="fg2" style="margin-bottom:8px">'+
      '<div class="fg"><label>Componente *</label>'+
        '<select class="ord-cid" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
          '<option value="">-- seleccionar --</option>'+compOpts+'</select></div>'+
      '<div class="fg"><label>Cantidad *</label><input class="ord-cant" type="number" min="1" value="1"></div>'+
    '</div></div>'+
    '<button class="btn btn-sm" onclick="addOrdenItemPv()" style="margin-bottom:10px">➕ Agregar ítem</button>'+
    '<div class="fg"><label>Observaciones</label><input id="ord-pv-obs" placeholder="Notas..."></div>',
    function(){
      var cids=[...document.querySelectorAll('.ord-cid')].map(function(s){return parseInt(s.value);});
      var cants=[...document.querySelectorAll('.ord-cant')].map(function(i){return parseFloat(i.value)||0;});
      var items=cids.map(function(cid,i){return {cid:cid,cant:cants[i]};}).filter(function(x){return x.cid&&x.cant>0;});
      if(!items.length){alert('Agregá al menos un componente.');return false;}
      DB.ordenes.unshift({
        id:DB.nid++, numero:getNumOC(), fecha:today(), estado:'Pendiente',
        items:items, proveedor:prov.empresa,
        obs:document.getElementById('ord-pv-obs').value
      });
      save(); goTo('ordenes'); return true;
    });
}

function addOrdenItemPv(){
  var cont=document.getElementById('orden-items-pv');
  var compOpts=[...DB.componentes].sort(function(a,b){var sa=(a.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();var sb=(b.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();return sa.localeCompare(sb,'es');}).map(function(c){
    return '<option value="'+c.id+'">'+c.codigo+' — '+c.desc+'</option>';
  }).join('');
  var div=document.createElement('div');
  div.className='fg2'; div.style.marginBottom='8px';
  div.innerHTML='<div class="fg"><label>Componente *</label>'+
    '<select class="ord-cid" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
    '<option value="">-- seleccionar --</option>'+compOpts+'</select></div>'+
    '<div class="fg"><label>Cantidad *</label><input class="ord-cant" type="number" min="1" value="1"></div>';
  cont.appendChild(div);
}

function pdfProveedores(){
  var empresa=(DB.config&&DB.config.empresa)||'Riego Adaptativo';
  var rows='';
  DB.proveedores.forEach(function(p){
    rows+='<tr><td><strong>'+p.empresa+'</strong></td><td>'+(p.rubro||'—')+'</td><td>'+(p.contacto||'—')+'</td>'+
      '<td>'+(p.tel||'—')+'</td><td>'+(p.email||'—')+'</td><td>'+(p.condiciones||'—')+'</td></tr>';
  });
  var css='*{box-sizing:border-box;margin:0;padding:0}body{font-family:Segoe UI,Arial,sans-serif;padding:24px;font-size:12px}'+
    'h1{font-size:16px;color:#256282;margin-bottom:4px}p{color:#666;font-size:11px;margin-bottom:16px}'+
    'table{width:100%;border-collapse:collapse}th{background:#256282;color:#fff;padding:7px 10px;font-size:10px;text-align:left}'+
    'td{padding:6px 10px;border-bottom:1px solid #eee}'+
    '.btn{position:fixed;top:12px;right:12px;background:#256282;color:#fff;border:none;padding:7px 16px;border-radius:6px;cursor:pointer}'+
    '@media print{.btn{display:none}}';
  var w=window.open('','_blank');
  w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Proveedores</title><style>'+css+'</style></head><body>'+
    '<button class="btn" onclick="window.print()">🖨️ Imprimir</button>'+
    '<h1>LISTA DE PROVEEDORES</h1><p>'+empresa+' · '+today()+'</p>'+
    '<table><thead><tr><th>Empresa</th><th>Rubro</th><th>Contacto</th><th>Teléfono</th><th>Email</th><th>Condiciones</th></tr></thead>'+
    '<tbody>'+rows+'</tbody></table></body></html>');
  w.document.close();
}


// GESTION ECONOMICA =========================================
// Vincula Gestión económica con Movimiento de fondos: cada adelanto/pago de saldo
// genera (o actualiza) su propio ingreso en DB.fondos, con rubro "Anticipos por ventas".
function crearOActualizarFondoGestion(fondoId, monto, fecha, clienteNombre, nota){
  if(!DB.fondos) DB.fondos=[];
  var cli=DB.clientes.find(function(c){return c.nombre===clienteNombre;});
  var existente=fondoId?DB.fondos.find(function(f){return f.id===fondoId;}):null;
  if(existente){
    existente.monto=monto;
    existente.fecha=fecha||existente.fecha;
    existente.desc=nota||existente.desc;
    return existente.id;
  }
  var nuevo={
    id:DB.nid++,
    tipo:'Ingreso',
    rubro:'Anticipos por ventas',
    fecha:fecha||today(),
    desc:nota||('Adelanto — '+(clienteNombre||'')),
    monto:monto,
    vinculo:cli?('cli:'+cli.id):''
  };
  DB.fondos.unshift(nuevo);
  return nuevo.id;
}

function renderGestion(){
  var el=document.getElementById('gestion-body');
  if(!el) return;
  var h='<div style="display:flex;justify-content:flex-end;margin-bottom:10px">'+
    '<button class="btn btn-p" onclick="modalGestion()">➕ Nueva gestión</button>'+
  '</div>';
  
  if(!DB.gestiones.length){
    h+='<div class="empty">Sin gestiones económicas registradas.</div>';
    el.innerHTML=h; return;
  }

  DB.gestiones.forEach(function(g){
    var pres=DB.presupuestos.find(function(p){return p.id===g.presId;});
    var cli=pres?g.clienteNombre||pres.nombre:'—';
    var saldo=g.montoSistema-(g.adelanto||0)-( g.pagos?g.pagos.reduce(function(a,p){return a+(parseFloat(p.monto)||0);},0):0);
    var tc=(DB.config&&DB.config.tipoCambio)||1;
    h+='<div class="card" style="margin-bottom:12px">'+
      '<div class="ch">'+
        '<div class="ct">'+cli+' — '+(pres?(pres.modelo||''):'')+'</div>'+
        '<div style="display:flex;gap:6px">'+
          '<button class="btn btn-sm" onclick="editarGestion('+g.id+')">✏️</button>'+
          '<button class="btn btn-sm btn-p" onclick="pdfGestion('+g.id+')">📄 PDF</button>'+
          '<button class="btn btn-sm" style="color:var(--red)" onclick="borrarGestion('+g.id+')">🗑️</button>'+
        '</div>'+
      '</div>'+
      '<div class="card-body">'+
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px">'+
          '<div class="stat"><div class="stat-n">$'+Math.round(g.montoSistema||0).toLocaleString('es-AR')+'</div><div class="stat-l">Monto total</div></div>'+
          '<div class="stat"><div class="stat-n green">$'+Math.round(g.adelanto||0).toLocaleString('es-AR')+'</div><div class="stat-l">Adelanto</div></div>'+
          '<div class="stat"><div class="stat-n '+(saldo>0?'amber':'green')+'">$'+Math.round(saldo).toLocaleString('es-AR')+'</div><div class="stat-l">Saldo pendiente</div></div>'+
          '<div class="stat"><div class="stat-n">'+(g.fechaEntregaReal||g.fechaEntregaProm||'—')+'</div><div class="stat-l">Entrega</div></div>'+
        '</div>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;color:var(--text2);margin-bottom:8px">'+
          '<div>Forma de pago: <strong>'+(g.formaPago||'—')+'</strong></div>'+
          '<div>Entrega prometida: <strong>'+(g.fechaEntregaProm||'—')+'</strong></div>'+
          '<div>Entrega real: <strong>'+(g.fechaEntregaReal||'—')+'</strong></div>'+
          '<div>Adelanto fecha: <strong>'+(g.adelantoFecha||'—')+'</strong></div>'+
        '</div>'+
        (g.pagos&&g.pagos.length?
          '<div class="sectitle" style="margin-bottom:6px">Pagos de saldo</div>'+
          '<table style="width:100%;border-collapse:collapse">'+
            '<thead><tr style="background:var(--surface2)"><th style="padding:5px 8px;font-size:10px">Fecha</th><th style="padding:5px 8px;font-size:10px;text-align:right">Monto</th><th style="padding:5px 8px;font-size:10px">Nota</th></tr></thead>'+
            '<tbody>'+g.pagos.map(function(p){
              return '<tr><td style="padding:5px 8px">'+p.fecha+'</td><td style="padding:5px 8px;text-align:right;font-weight:600">$'+Math.round(p.monto||0).toLocaleString('es-AR')+'</td><td style="padding:5px 8px;font-size:11px">'+(p.nota||'—')+'</td></tr>';
            }).join('')+'</tbody></table>'
        :'')+
      '</div>'+
    '</div>';
  });
  el.innerHTML=h;
}

function modalGestion(){
  // Get approved presupuestos
  var presOpts=DB.presupuestos.filter(function(p){return p.estado==='Aprobado';}).map(function(p){
    return '<option value="'+p.id+'">'+presNum(p)+' — '+p.nombre+'</option>';
  }).join('');
  if(!presOpts){alert('No hay presupuestos aprobados. Aprobá un presupuesto primero.');return;}
  
  openModal('Nueva gestión económica',
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
    '<div class="fg" style="grid-column:1/-1"><label>Presupuesto aprobado *</label>'+
      '<select id="gest-pres" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%" onchange="cargarDatosGestion()">'+
      '<option value="">-- seleccionar --</option>'+presOpts+'</select></div>'+
    '<div class="fg"><label>Monto del sistema ($)</label><input id="gest-monto" type="number" min="0" value="0"></div>'+
    '<div class="fg"><label>Forma de pago</label><input id="gest-fp" value=""></div>'+
    '<div class="fg"><label>Entrega prometida</label><input id="gest-eprom" type="date" value="'+today()+'"></div>'+
    '<div class="fg"><label>Entrega real</label><input id="gest-ereal" type="date" value=""></div>'+
    '<div class="fg"><label>Fecha del adelanto</label><input id="gest-afecha" type="date" value="'+today()+'"></div>'+
    '<div class="fg"><label>Monto del adelanto ($)</label><input id="gest-amonto" type="number" min="0" value="0"></div>'+
    '</div>',
    function(){
      var presId=parseInt(document.getElementById('gest-pres').value);
      if(!presId){alert('Seleccioná un presupuesto.');return false;}
      var pres=DB.presupuestos.find(function(p){return p.id===presId;});
      var nombreCli=pres?pres.nombre:'';
      var adelantoMonto=parseFloat(document.getElementById('gest-amonto').value)||0;
      var adelantoFecha=document.getElementById('gest-afecha').value;
      var nuevaG={
        id:DB.nid++,
        presId:presId,
        clienteNombre:nombreCli,
        montoSistema:parseFloat(document.getElementById('gest-monto').value)||0,
        formaPago:document.getElementById('gest-fp').value,
        fechaEntregaProm:document.getElementById('gest-eprom').value,
        fechaEntregaReal:document.getElementById('gest-ereal').value,
        adelantoFecha:adelantoFecha,
        adelanto:adelantoMonto,
        pagos:[],
        fondoAdelantoId:null
      };
      if(adelantoMonto>0){
        nuevaG.fondoAdelantoId=crearOActualizarFondoGestion(null,adelantoMonto,adelantoFecha,nombreCli,'Adelanto — '+nombreCli);
      }
      DB.gestiones.unshift(nuevaG);
      save(); renderGestion(); return true;
    });
}

function cargarDatosGestion(){
  var presId=parseInt(document.getElementById('gest-pres').value);
  if(!presId) return;
  var p=DB.presupuestos.find(function(x){return x.id===presId;});
  if(!p) return;
  var total=calcTotal(p);
  document.getElementById('gest-monto').value=Math.round(total);
  document.getElementById('gest-fp').value=p.formaPago||'';
}

function editarGestion(id){
  var g=DB.gestiones.find(function(x){return x.id===id;});
  if(!g) return;
  openModal('Gestión — '+g.clienteNombre,
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
    '<div class="fg"><label>Monto del sistema ($)</label><input id="eg-monto" type="number" value="'+(g.montoSistema||0)+'"></div>'+
    '<div class="fg"><label>Forma de pago</label><input id="eg-fp" value="'+(g.formaPago||'')+'"></div>'+
    '<div class="fg"><label>Entrega prometida</label><input id="eg-eprom" type="date" value="'+(g.fechaEntregaProm||'')+'"></div>'+
    '<div class="fg"><label>Entrega real</label><input id="eg-ereal" type="date" value="'+(g.fechaEntregaReal||'')+'"></div>'+
    '<div class="fg"><label>Fecha del adelanto</label><input id="eg-afecha" type="date" value="'+(g.adelantoFecha||'')+'"></div>'+
    '<div class="fg"><label>Monto del adelanto ($)</label><input id="eg-amonto" type="number" value="'+(g.adelanto||0)+'"></div>'+
    '</div>'+
    '<hr class="div"><div class="sectitle">Registrar pago de saldo</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">'+
    '<div class="fg"><label>Fecha</label><input id="eg-pfecha" type="date" value="'+today()+'"></div>'+
    '<div class="fg"><label>Monto ($)</label><input id="eg-pmonto" type="number" min="0" value="0"></div>'+
    '<div class="fg"><label>Nota</label><input id="eg-pnota" placeholder="Ej: Transferencia..."></div>'+
    '</div>',
    function(){
      g.montoSistema=parseFloat(document.getElementById('eg-monto').value)||0;
      g.formaPago=document.getElementById('eg-fp').value;
      g.fechaEntregaProm=document.getElementById('eg-eprom').value;
      g.fechaEntregaReal=document.getElementById('eg-ereal').value;
      g.adelantoFecha=document.getElementById('eg-afecha').value;
      g.adelanto=parseFloat(document.getElementById('eg-amonto').value)||0;
      if(g.adelanto>0){
        g.fondoAdelantoId=crearOActualizarFondoGestion(g.fondoAdelantoId,g.adelanto,g.adelantoFecha,g.clienteNombre,'Adelanto — '+g.clienteNombre);
      }
      var pmonto=parseFloat(document.getElementById('eg-pmonto').value)||0;
      if(pmonto>0){
        if(!g.pagos) g.pagos=[];
        var pfecha=document.getElementById('eg-pfecha').value;
        var pnota=document.getElementById('eg-pnota').value;
        var fondoIdPago=crearOActualizarFondoGestion(null,pmonto,pfecha,g.clienteNombre,'Pago de saldo — '+g.clienteNombre+(pnota?' ('+pnota+')':''));
        g.pagos.push({fecha:pfecha,monto:pmonto,nota:pnota,fondoId:fondoIdPago});
      }
      save(); renderGestion(); return true;
    });
}

function borrarGestion(id){
  var g=DB.gestiones.find(function(x){return x.id===id;});
  if(!g) return;
  var idsFondos=[];
  if(g.fondoAdelantoId) idsFondos.push(g.fondoAdelantoId);
  (g.pagos||[]).forEach(function(p){ if(p.fondoId) idsFondos.push(p.fondoId); });
  var msg='¿Eliminar esta gestión económica?';
  if(idsFondos.length) msg+='\n\nTiene '+idsFondos.length+' movimiento(s) vinculados en Fondos (adelanto y/o pagos de saldo).';
  if(!confirm(msg)) return;
  var borrarFondosTambien=idsFondos.length>0 && confirm('¿Eliminar también esos '+idsFondos.length+' movimiento(s) de Fondos vinculados? (Cancelar los deja en Fondos como movimientos sueltos)');
  if(borrarFondosTambien){
    DB.fondos=(DB.fondos||[]).filter(function(f){return idsFondos.indexOf(f.id)===-1;});
  }
  DB.gestiones=DB.gestiones.filter(function(x){return x.id!==id;});
  save(); renderGestion();
}

function pdfGestion(id){
  var g=DB.gestiones.find(function(x){return x.id===id;});
  if(!g) return;
  var pres=DB.presupuestos.find(function(p){return p.id===g.presId;});
  var empresa=(DB.config&&DB.config.empresa)||'Riego Adaptativo';
  var saldo=g.montoSistema-(g.adelanto||0)-(g.pagos?g.pagos.reduce(function(a,p){return a+(parseFloat(p.monto)||0);},0):0);
  var tc=(DB.config&&DB.config.tipoCambio)||1;

  var pagosRows=g.pagos&&g.pagos.length?g.pagos.map(function(p){
    return '<tr><td>'+p.fecha+'</td><td style="text-align:right">$'+Math.round(p.monto||0).toLocaleString('es-AR')+'</td><td>'+(p.nota||'—')+'</td></tr>';
  }).join(''):'<tr><td colspan="3" style="color:#999;font-style:italic">Sin pagos de saldo registrados</td></tr>';

  var css='*{box-sizing:border-box;margin:0;padding:0}body{font-family:Segoe UI,Arial,sans-serif;padding:24px;font-size:12px}'+
    'h1{font-size:16px;color:#256282;margin-bottom:2px}h2{font-size:13px;font-weight:600;color:#444;margin:16px 0 8px}'+
    '.meta{font-size:11px;color:#666;margin-bottom:16px}'+
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}'+
    '.box{background:#f8f8f8;border-radius:6px;padding:9px 12px}'+
    '.box .l{font-size:9px;text-transform:uppercase;color:#999;font-weight:700;margin-bottom:2px}'+
    '.box .v{font-size:14px;font-weight:700}'+
    'table{width:100%;border-collapse:collapse}th{background:#256282;color:#fff;padding:6px 10px;font-size:10px;text-align:left}'+
    'td{padding:6px 10px;border-bottom:1px solid #eee;font-size:11px}'+
    '.total{background:#256282;color:#fff;padding:10px 16px;border-radius:6px;display:flex;justify-content:space-between;align-items:center;margin-top:16px}'+
    '.btn{position:fixed;top:12px;right:12px;background:#256282;color:#fff;border:none;padding:7px 16px;border-radius:6px;cursor:pointer}'+
    '@media print{.btn{display:none}}';

  var w=window.open('','_blank');
  w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Gestión — '+g.clienteNombre+'</title><style>'+css+'</style></head><body>'+
    '<button class="btn" onclick="window.print()">🖨️ Imprimir</button>'+
    '<h1>GESTIÓN ECONÓMICA</h1>'+
    '<div class="meta">'+empresa+' · '+(pres?presNum(pres)+' — '+(pres.modelo||''):'')+'</div>'+
    '<h2>Datos del cliente</h2>'+
    '<div class="grid">'+
      '<div class="box"><div class="l">Cliente</div><div class="v">'+g.clienteNombre+'</div></div>'+
      '<div class="box"><div class="l">Forma de pago pactada</div><div class="v" style="font-size:12px">'+(g.formaPago||'—')+'</div></div>'+
      '<div class="box"><div class="l">Entrega prometida</div><div class="v">'+(g.fechaEntregaProm||'—')+'</div></div>'+
      '<div class="box"><div class="l">Entrega real</div><div class="v">'+(g.fechaEntregaReal||'Pendiente')+'</div></div>'+
    '</div>'+
    '<h2>Estado económico</h2>'+
    '<div class="grid">'+
      '<div class="box"><div class="l">Monto del sistema</div><div class="v">$'+Math.round(g.montoSistema||0).toLocaleString('es-AR')+'</div></div>'+
      '<div class="box"><div class="l">Adelanto recibido ('+( g.adelantoFecha||'')+')</div><div class="v" style="color:green">$'+Math.round(g.adelanto||0).toLocaleString('es-AR')+'</div></div>'+
    '</div>'+
    '<h2>Pagos de saldo</h2>'+
    '<table><thead><tr><th>Fecha</th><th style="text-align:right">Monto</th><th>Detalle</th></tr></thead><tbody>'+pagosRows+'</tbody></table>'+
    '<div class="total">'+
      '<span>SALDO PENDIENTE</span>'+
      '<span style="font-size:18px;font-weight:700">$'+Math.round(saldo).toLocaleString('es-AR')+
      (tc>1?' / U$S '+(saldo/tc).toFixed(0):'')+
      '</span>'+
    '</div>'+
    '</body></html>');
  w.document.close();
}


// MOVIMIENTO DE FONDOS =====================================
const RUBROS_ING = ['Anticipos por ventas','Cancelaciones por ventas','Venta de partes y repuestos',
  'M.O. servicio de mantenimiento','M.O. actualizaciones','M.O. modificaciones de instalacion','Otros'];
const RUBROS_EGR = ['Compra de materiales','Gastos de movilidad','Reposicion de stock','Fletes y envios','Otros'];



function getNumRecibo(){
  var yr = new Date().getFullYear();
  var existing = (DB.fondos||[]).filter(function(f){
    return f.numRecibo && f.numRecibo.startsWith('REC-'+yr);
  });
  var max = 0;
  existing.forEach(function(f){
    var n = parseInt((f.numRecibo||'').split('-')[2]||'0');
    if(n>max) max=n;
  });
  return 'REC-'+yr+'-'+String(max+1).padStart(4,'0');
}

function pdfRecibo(fondoId){
  var fondo = (DB.fondos||[]).find(function(x){return x.id===fondoId;});
  if(!fondo) return;

  var empresa = (DB.config&&DB.config.empresa)||'Riego Adaptativo';
  var empresaSub = 'Ingeniería en Sistemas de Riego';
  var tc = (DB.config&&DB.config.tipoCambio)||1;

  // Get client data
  var cliente = null;
  if(fondo.vinculo&&fondo.vinculo.startsWith('cli:')){
    cliente = DB.clientes.find(function(c){return c.id===parseInt(fondo.vinculo.slice(4));});
  }

  // Get presupuesto
  var pres = null;
  if(cliente&&cliente.presId){
    pres = DB.presupuestos.find(function(p){return p.id===cliente.presId;});
  }

  // Assign recibo number if not yet assigned
  if(!fondo.numRecibo){
    fondo.numRecibo = getNumRecibo();
    save();
  }

  var monto = parseFloat(fondo.monto)||0;
  var usd = tc>1 ? 'U$S '+Math.round(monto/tc).toLocaleString('es-AR')+' (TC $'+tc+')' : null;

  var presNum = pres ? (function(){
    var yr2=new Date(pres.fecha||today()).getFullYear();
    return 'VSS-'+yr2+'-'+String(pres.correlativo||pres.id).padStart(4,'0');
  })() : '—';
  var presModelo = pres ? (pres.modelo||'AquaOne') : '—';

  var reciboHTML = function(num){
    return '<div class="recibo">'+
      '<div class="header">'+
        '<div>'+
          '<div class="empresa">'+empresa.toUpperCase()+'</div>'+
          '<div class="empresa-sub">'+empresaSub+'</div>'+
        '</div>'+
        '<div class="rec-num">'+
          '<div class="label">Recibo N°</div>'+
          '<div class="num">'+fondo.numRecibo+'</div>'+
        '</div>'+
      '</div>'+
      '<div class="concepto-box">Recibo de anticipo</div>'+
      '<div class="datos">'+
        '<div class="l">Cliente</div><div class="v bold">'+(cliente?cliente.nombre:(fondo.desc||'—'))+'</div>'+
        '<div class="l">Domicilio</div><div class="v">'+(cliente?(cliente.lote||'—')+(cliente.barrio?' · '+cliente.barrio:''):'—')+'</div>'+
        '<div class="l">Teléfono</div><div class="v">'+(cliente?cliente.tel||'—':'—')+'</div>'+
        '<div class="l">Presupuesto</div><div class="v">'+presNum+(presModelo!=='—'?' — '+presModelo:'')+'</div>'+
        '<div class="l">Concepto</div><div class="v">Anticipo por instalación de sistema de riego</div>'+
      '</div>'+
      '<div class="monto-box">'+
        '<div class="monto-label">Monto recibido</div>'+
        '<div>'+
          '<div class="monto-valor">$'+Math.round(monto).toLocaleString('es-AR')+'</div>'+
          (usd?'<div class="monto-usd">'+usd+'</div>':'<div class="monto-usd">—</div>')+
        '</div>'+
      '</div>'+
      '<div class="footer">'+
        '<div class="firma-area">'+
          '<div class="firma-espacio"></div>'+
          '<div class="firma-linea">'+empresa+'</div>'+
        '</div>'+
        '<div class="fecha-box">'+
          '<div class="fecha-label">Fecha</div>'+
          '<div class="fecha-val">'+fondo.fecha+'</div>'+
        '</div>'+
      '</div>'+
      (num<3?'<div class="cut">✂ · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · ·</div>':'')
    +'</div>';
  };

  var css = '*{box-sizing:border-box;margin:0;padding:0}'+
    'body{font-family:Arial,sans-serif;padding:0;width:210mm}'+
    '.page{width:210mm;background:#fff;display:grid;grid-template-rows:repeat(3,99mm)}'+
    '.recibo{padding:16px 20px;border-bottom:2px dashed #bbb;position:relative;display:flex;flex-direction:column;justify-content:space-between;height:99mm;overflow:hidden}'+
    '.recibo:last-child{border-bottom:none}'+
    '.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #256282;padding-bottom:5px;margin-bottom:7px}'+
    '.empresa{font-size:17px;font-weight:700;color:#256282}'+
    '.empresa-sub{font-size:12px;color:#666;margin-top:2px}'+
    '.rec-num .label{font-size:12px;color:#666;text-transform:uppercase;text-align:right}'+
    '.rec-num .num{font-size:18px;font-weight:700;font-family:monospace;color:#111}'+
    '.concepto-box{background:#256282;color:#fff;text-align:center;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:5px 0;margin-bottom:8px;border-radius:0;margin-left:-20px;margin-right:-20px;padding-left:20px;padding-right:20px}'+
    '.datos{display:grid;grid-template-columns:100px 1fr;gap:4px 10px;font-size:13px;margin-bottom:8px}'+
    '.datos .l{color:#666;font-weight:700;text-transform:uppercase}'+
    '.datos .v{color:#111}'+
    '.datos .v.bold{font-weight:700;color:#000}'+
    '.monto-box{background:#f8f8f8;border:1px solid #ddd;border-radius:3px;padding:6px 14px;display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}'+
    '.monto-label{font-size:12px;color:#666;text-transform:uppercase;font-weight:700}'+
    '.monto-valor{font-size:24px;font-weight:700;color:#256282}'+
    '.monto-usd{font-size:12px;color:#999;text-align:right}'+
    '.footer{display:flex;justify-content:space-between;align-items:flex-end}'+
    '.firma-area{width:220px}'+
    '.firma-espacio{height:52px}'+
    '.firma-linea{border-top:1.5px solid #333;padding-top:4px;font-size:11px;color:#555;text-align:center}'+
    '.fecha-box{text-align:right}'+
    '.fecha-label{font-size:11px;color:#666;text-transform:uppercase;font-weight:700}'+
    '.fecha-val{font-size:13px;font-weight:700;color:#333}'+
    '.cut{display:block;width:100%;border:none;border-top:2px dashed #bbb;margin:0}'+
    '.btn{position:fixed;top:12px;right:12px;background:#256282;color:#fff;border:none;padding:7px 16px;border-radius:5px;cursor:pointer;font-size:12px}'+
    '@media print{.btn{display:none}@page{size:A4 portrait;margin:0}}';

  var w = window.open('','_blank');
  w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Recibo '+fondo.numRecibo+'</title><style>'+css+'</style></head><body>'+
    '<button class="btn" onclick="window.print()">🖨️ Imprimir</button>'+
    '<div class="page">'+
      reciboHTML(1)+
      reciboHTML(2)+
      reciboHTML(3)+
    '</div></body></html>');
  w.document.close();
}


function renderFondos(){
  var el = document.getElementById('fondos-body');
  if(!el) return;
  var tc = (DB.config&&DB.config.tipoCambio)||1;

  var hoy = today();
  var primerDiaMes = hoy.slice(0,7)+'-01';
  var h = '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'+
      '<select id="ff-tipo" onchange="renderFondos()" style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)">'+
        '<option value="">Todos</option><option>Ingreso</option><option>Egreso</option>'+
      '</select>'+
      '<select id="ff-rubro" onchange="renderFondos()" style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)">'+
        '<option value="">Todos los rubros</option>'+
        RUBROS_ING.map(function(r){return '<option>'+r+'</option>';}).join('')+
        RUBROS_EGR.map(function(r){return '<option>'+r+'</option>';}).join('')+
      '</select>'+
      '<label style="font-size:11px;color:var(--text2)">Desde</label>'+
      '<input id="ff-desde" type="date" value="'+(document.getElementById('ff-desde')?document.getElementById('ff-desde').value:primerDiaMes)+'" onchange="renderFondos()" style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)">'+
      '<label style="font-size:11px;color:var(--text2)">Hasta</label>'+
      '<input id="ff-hasta" type="date" value="'+(document.getElementById('ff-hasta')?document.getElementById('ff-hasta').value:hoy)+'" onchange="renderFondos()" style="padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;background:var(--surface)">'+
      '<button class="btn btn-sm" onclick="limpiarFiltrosFondos()">✕ Limpiar</button>'+
    '</div>'+
    '<div style="display:flex;gap:8px">'+
      '<button class="btn btn-sm" onclick="pdfFondos()">🖨️ PDF</button>'+
      '<button class="btn btn-p" onclick="modalFondo()">➕ Nuevo</button>'+
    '</div>'+
  '</div>';

  var ftipo = document.getElementById('ff-tipo')?document.getElementById('ff-tipo').value:'';
  var frubro = document.getElementById('ff-rubro')?document.getElementById('ff-rubro').value:'';
  var fdesde = document.getElementById('ff-desde')?document.getElementById('ff-desde').value:'';
  var fhasta = document.getElementById('ff-hasta')?document.getElementById('ff-hasta').value:'';

  var lista = (DB.fondos||[]).filter(function(f){
    return (!ftipo||f.tipo===ftipo) &&
           (!frubro||f.rubro===frubro) &&
           (!fdesde||f.fecha>=fdesde) &&
           (!fhasta||f.fecha<=fhasta);
  }).sort(function(a,b){ return a.fecha > b.fecha ? -1 : 1; });

  // Totals
  var totalIng = lista.filter(function(f){return f.tipo==='Ingreso';}).reduce(function(a,f){return a+(parseFloat(f.monto)||0);},0);
  var totalEgr = lista.filter(function(f){return f.tipo==='Egreso';}).reduce(function(a,f){return a+(parseFloat(f.monto)||0);},0);
  var saldo = totalIng - totalEgr;

  var meta = (DB.config&&DB.config.metaMensual)||0;
  var mesActual = today().slice(0,7);
  var facMes = (DB.fondos||[]).filter(function(f){return f.tipo==='Ingreso'&&f.fecha&&f.fecha.slice(0,7)===mesActual;}).reduce(function(a,f){return a+(parseFloat(f.monto)||0);},0);

  h += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">'+
    '<div class="stat"><div class="stat-n green">$'+Math.round(totalIng).toLocaleString('es-AR')+'</div><div class="stat-l">Total ingresos</div></div>'+
    '<div class="stat"><div class="stat-n red">$'+Math.round(totalEgr).toLocaleString('es-AR')+'</div><div class="stat-l">Total egresos</div></div>'+
    '<div class="stat"><div class="stat-n '+(saldo>=0?'green':'red')+'">$'+Math.round(saldo).toLocaleString('es-AR')+'</div><div class="stat-l">Saldo</div></div>'+
  '</div>';

  if(!lista.length){
    h += '<div class="empty">Sin movimientos registrados.</div>';
    el.innerHTML = h; return;
  }

  h += '<table><thead><tr>'+
    '<th style="width:90px">Fecha</th>'+
    '<th style="width:80px">Tipo</th>'+
    '<th>Rubro</th>'+
    '<th>Descripción</th>'+
    '<th>Cliente/Proveedor</th>'+
    '<th style="text-align:right">Monto $</th>'+
    '<th style="text-align:right">Monto U$S</th>'+
    '<th style="width:70px"></th>'+
  '</tr></thead><tbody>';

  lista.forEach(function(f){
    var esIng = f.tipo==='Ingreso';
    var usd = tc>1?(parseFloat(f.monto)||0)/tc:null;
    h += '<tr>'+
      '<td style="font-size:11px">'+f.fecha+'</td>'+
      '<td><span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:'+(esIng?'#1B5E20':'#B71C1C')+';color:#fff">'+f.tipo+'</span></td>'+
      '<td style="font-size:11px">'+f.rubro+'</td>'+
      '<td style="font-size:11px">'+(f.desc||'—')+'</td>'+
      '<td style="font-size:11px">'+(function(){
        if(!f.vinculo) return '—';
        if(f.vinculo.startsWith('cli:')){var c=DB.clientes.find(function(x){return x.id===parseInt(f.vinculo.slice(4));});return c?c.nombre:'—';}
        if(f.vinculo.startsWith('prov:')){var p=DB.proveedores.find(function(x){return x.id===parseInt(f.vinculo.slice(5));});return p?p.empresa:'—';}
        return '—';
      })()+'</td>'+
      '<td style="text-align:right;font-weight:700;color:'+(esIng?'var(--green)':'var(--red)')+'">$'+Math.round(parseFloat(f.monto)||0).toLocaleString('es-AR')+'</td>'+
      '<td style="text-align:right;font-size:11px;color:var(--text2)">'+(usd?'U$S '+usd.toFixed(0):'—')+'</td>'+
      '<td style="display:flex;gap:3px">'+
        (function(){
          return '';
        })()+
        (f.rubro==='Anticipos por ventas'?'<button class="btn btn-sm" onclick="pdfRecibo('+f.id+')" title="Recibo de anticipo">🧾</button>':'')+
        (f.rubro==='Anticipos por ventas'?'<button class="btn btn-sm" onclick="pdfRecibo('+f.id+')" title="Recibo">🧾</button>':'')+
        '<button class="btn btn-sm" onclick="editarFondo('+f.id+')">✏️</button>'+
        '<button class="btn btn-sm" style="color:var(--red)" onclick="borrarFondo('+f.id+')">🗑️</button>'+
      '</td>'+
    '</tr>';
  });
  h += '</tbody></table>';
  el.innerHTML = h;
}

function limpiarFiltrosFondos(){
  var hoy = today();
  var primerDiaMes = hoy.slice(0,7)+'-01';
  var el;
  el=document.getElementById('ff-tipo'); if(el) el.value='';
  el=document.getElementById('ff-rubro'); if(el) el.value='';
  el=document.getElementById('ff-desde'); if(el) el.value=primerDiaMes;
  el=document.getElementById('ff-hasta'); if(el) el.value=hoy;
  renderFondos();
}

function modalFondo(id){
  var f = id?DB.fondos.find(function(x){return x.id===id;}):null;
  var rubIngOpts = RUBROS_ING.map(function(r){return '<option'+(f&&f.rubro===r?' selected':'')+'>'+r+'</option>';}).join('');
  var rubEgrOpts = RUBROS_EGR.map(function(r){return '<option'+(f&&f.rubro===r?' selected':'')+'>'+r+'</option>';}).join('');
  openModal(f?'Editar movimiento':'Nuevo movimiento de fondos',
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
    '<div class="fg"><label>Tipo *</label>'+
      '<select id="fo-tipo" onchange="actualizarRubrosFondo()" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
        '<option'+(f&&f.tipo==='Ingreso'?' selected':'')+'>Ingreso</option>'+
        '<option'+(f&&f.tipo==='Egreso'?' selected':'')+'>Egreso</option>'+
      '</select></div>'+
    '<div class="fg"><label>Fecha *</label><input id="fo-fecha" type="date" value="'+(f?f.fecha:today())+'"></div>'+
    '<div class="fg" style="grid-column:1/-1"><label>Rubro *</label>'+
      '<select id="fo-rubro" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
        '<optgroup label="Ingresos">'+rubIngOpts+'</optgroup>'+
        '<optgroup label="Egresos">'+rubEgrOpts+'</optgroup>'+
      '</select></div>'+
    '<div class="fg"><label>Monto ($) *</label><input id="fo-monto" type="number" min="0" value="'+(f?f.monto:0)+'"></div>'+
    '<div class="fg"><label>Descripción</label><input id="fo-desc" value="'+(f?f.desc||'':'')+'" placeholder="Detalle opcional"></div>'+
    '<div class="fg" style="grid-column:1/-1"><label>Cliente / Proveedor</label>'+
      '<select id="fo-vinculo" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
        '<option value="">-- sin vincular --</option>'+
        '<optgroup label="Clientes">'+DB.clientes.filter(function(c){return c.estado==='Activo';}).map(function(c){return '<option value="cli:'+c.id+'"'+(f&&f.vinculo==='cli:'+c.id?' selected':'')+'>'+c.nombre+'</option>';}).join('')+'</optgroup>'+
        '<optgroup label="Proveedores">'+[...DB.proveedores].sort(function(a,b){return (a.empresa||'').localeCompare(b.empresa||'');}).map(function(p){return '<option value="prov:'+p.id+'"'+(f&&f.vinculo==='prov:'+p.id?' selected':'')+'>'+p.empresa+'</option>';}).join('')+'</optgroup>'+
      '</select></div>'+
    '</div>',
    function(){
      var tipo=document.getElementById('fo-tipo').value;
      var monto=parseFloat(document.getElementById('fo-monto').value)||0;
      if(!monto){alert('Ingresá un monto.');return false;}
      var obj={
        id:f?f.id:DB.nid++,
        tipo:tipo,
        fecha:document.getElementById('fo-fecha').value,
        rubro:document.getElementById('fo-rubro').value,
        monto:monto,
        desc:document.getElementById('fo-desc').value,
        vinculo:document.getElementById('fo-vinculo').value
      };
      if(f){ var idx=DB.fondos.findIndex(function(x){return x.id===f.id;}); DB.fondos[idx]=obj; }
      else DB.fondos.unshift(obj);
      save(); renderFondos(); return true;
    });
}

function actualizarRubrosFondo(){
  var tipo=document.getElementById('fo-tipo').value;
  var sel=document.getElementById('fo-rubro');
  if(!sel) return;
  var rubros=tipo==='Ingreso'?RUBROS_ING:RUBROS_EGR;
  sel.innerHTML='<optgroup label="'+tipo+'s">'+rubros.map(function(r){return '<option>'+r+'</option>';}).join('')+'</optgroup>';
}

function editarFondo(id){ modalFondo(id); }

function borrarFondo(id){
  if(!confirm('¿Eliminar este movimiento?')) return;
  DB.fondos=DB.fondos.filter(function(x){return x.id!==id;});
  save(); renderFondos();
}

function pdfFondos(){
  var tc=(DB.config&&DB.config.tipoCambio)||1;
  var empresa=(DB.config&&DB.config.empresa)||'Riego Adaptativo';
  var lista=(DB.fondos||[]).slice().sort(function(a,b){return a.fecha>b.fecha?-1:1;});
  var totalIng=lista.filter(function(f){return f.tipo==='Ingreso';}).reduce(function(a,f){return a+(parseFloat(f.monto)||0);},0);
  var totalEgr=lista.filter(function(f){return f.tipo==='Egreso';}).reduce(function(a,f){return a+(parseFloat(f.monto)||0);},0);
  var saldo=totalIng-totalEgr;

  var rows=lista.map(function(f){
    var esIng=f.tipo==='Ingreso';
    var usd=tc>1?(parseFloat(f.monto)||0)/tc:null;
    return '<tr>'+
      '<td>'+f.fecha+'</td>'+
      '<td><strong style="color:'+(esIng?'green':'#B71C1C')+'">'+f.tipo+'</strong></td>'+
      '<td>'+f.rubro+'</td>'+
      '<td>'+(f.desc||'—')+'</td>'+
      '<td>'+(function(){
        if(!f.vinculo) return '—';
        if(f.vinculo.startsWith('cli:')){var c=DB.clientes.find(function(x){return x.id===parseInt(f.vinculo.slice(4));});return c?c.nombre:'—';}
        if(f.vinculo.startsWith('prov:')){var p=DB.proveedores.find(function(x){return x.id===parseInt(f.vinculo.slice(5));});return p?p.empresa:'—';}
        return '—';
      })()+'</td>'+
      '<td style="text-align:right;color:'+(esIng?'green':'#B71C1C')+'">$'+Math.round(parseFloat(f.monto)||0).toLocaleString('es-AR')+'</td>'+
      '<td style="text-align:right;color:#666">'+(usd?'U$S '+usd.toFixed(0):'—')+'</td>'+
    '</tr>';
  }).join('');

  var css='*{box-sizing:border-box;margin:0;padding:0}body{font-family:Segoe UI,Arial,sans-serif;padding:24px;font-size:11px}'+
    'h1{font-size:15px;color:#256282;margin-bottom:2px}.meta{color:#666;font-size:10px;margin-bottom:14px}'+
    '.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}'+
    '.stat{background:#f5f5f5;border-radius:5px;padding:9px;text-align:center}'+
    '.stat .n{font-size:14px;font-weight:700;margin-bottom:2px}.stat .l{font-size:9px;color:#888;text-transform:uppercase}'+
    'table{width:100%;border-collapse:collapse}th{background:#256282;color:#fff;padding:6px 9px;font-size:10px;text-align:left}'+
    'td{padding:5px 9px;border-bottom:1px solid #eee}'+
    'tfoot td{background:#222;color:#fff;font-weight:700;padding:7px 9px}'+
    '.btn{position:fixed;top:12px;right:12px;background:#256282;color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer}'+
    '@media print{.btn{display:none}}';

  var w=window.open('','_blank');
  w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Movimiento de fondos</title><style>'+css+'</style></head><body>'+
    '<button class="btn" onclick="window.print()">🖨️ Imprimir</button>'+
    '<h1>MOVIMIENTO DE FONDOS</h1>'+
    '<div class="meta">'+empresa+' · '+today()+'</div>'+
    '<div class="stats">'+
      '<div class="stat"><div class="n" style="color:green">$'+Math.round(totalIng).toLocaleString('es-AR')+'</div><div class="l">Total ingresos</div></div>'+
      '<div class="stat"><div class="n" style="color:#B71C1C">$'+Math.round(totalEgr).toLocaleString('es-AR')+'</div><div class="l">Total egresos</div></div>'+
      '<div class="stat"><div class="n" style="color:'+(saldo>=0?'green':'#B71C1C')+'">$'+Math.round(saldo).toLocaleString('es-AR')+'</div><div class="l">Saldo</div></div>'+
    '</div>'+
    '<table><thead><tr><th>Fecha</th><th>Tipo</th><th>Rubro</th><th>Descripción</th><th>Cliente/Proveedor</th><th style="text-align:right">Monto $</th><th style="text-align:right">Monto U$S</th></tr></thead>'+
    '<tbody>'+rows+'</tbody>'+
    '<tfoot><tr><td colspan="4">TOTALES</td>'+
      '<td style="text-align:right">Ing: $'+Math.round(totalIng).toLocaleString('es-AR')+' / Egr: $'+Math.round(totalEgr).toLocaleString('es-AR')+'</td>'+
      '<td style="text-align:right">Saldo: $'+Math.round(saldo).toLocaleString('es-AR')+'</td>'+
    '</tr></tfoot></table></body></html>');
  w.document.close();
}


// BUSQUEDA GLOBAL ==========================================
function busquedaGlobal(q){
  if(!q||q.length<2) {
    document.getElementById('search-results').innerHTML='';
    document.getElementById('search-results').style.display='none';
    return;
  }
  var ql = q.toLowerCase();
  var results = [];

  // Clientes
  DB.clientes.forEach(function(c){
    if((c.nombre+c.lote+c.barrio+c.tel+c.email+(c.mac||'')).toLowerCase().includes(ql)){
      results.push({tipo:'Cliente',icon:'👤',label:c.nombre,sub:c.lote+(c.barrio?' · '+c.barrio:''),action:"goTo('clientes');setTimeout(function(){verCliente("+c.id+")},200)"});
    }
  });

  // Presupuestos
  DB.presupuestos.forEach(function(p){
    if((p.nombre+(p.dir||'')+(p.tel||'')+(p.email||'')).toLowerCase().includes(ql)){
      results.push({tipo:'Presupuesto',icon:'📄',label:presNum(p)+' — '+p.nombre,sub:p.estado+' · '+(getLineaPres(p)?getLineaPres(p).nombre:'sin línea'),action:"abrirEditorPres("+p.id+")"});
    }
  });

  // Proveedores
  DB.proveedores.forEach(function(p){
    if((p.empresa+(p.contacto||'')+(p.email||'')+(p.rubro||'')).toLowerCase().includes(ql)){
      results.push({tipo:'Proveedor',icon:'🏭',label:p.empresa,sub:(p.rubro||'')+(p.contacto?' · '+p.contacto:''),action:"goTo('proveedores')"});
    }
  });

  // Componentes
  DB.componentes.forEach(function(c){
    if((c.codigo+c.desc+(c.proveedor||'')).toLowerCase().includes(ql)){
      results.push({tipo:'Componente',icon:'📦',label:c.codigo+' — '+c.desc,sub:(c.categoria||'')+(c.ubicacion?' · '+c.ubicacion:''),action:"goTo('catalogo')"});
    }
  });

  var el = document.getElementById('search-results');
  if(!results.length){
    el.innerHTML='<div style="padding:10px 14px;color:var(--text2);font-size:12px">Sin resultados para "'+q+'"</div>';
  } else {
    el.innerHTML = results.slice(0,8).map(function(r,i){
      return '<div id="sr'+i+'" style="padding:8px 14px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">'+
        '<span style="font-size:16px">'+r.icon+'</span>'+
        '<div><div style="font-size:12px;font-weight:600">'+r.label+'</div>'+
        '<div style="font-size:10px;color:var(--text2)">'+r.tipo+' · '+r.sub+'</div></div>'+
      '</div>';
    }).join('');
    results.slice(0,8).forEach(function(r,i){
      var d=document.getElementById('sr'+i);
      if(d){ (function(act){d.onclick=function(){eval(act);cerrarBusqueda();};})(r.action); }
    });
  }
  el.style.display='block';
}

function cerrarBusqueda(){
  var el=document.getElementById('search-results');
  if(el){el.innerHTML='';el.style.display='none';}
  var inp=document.getElementById('global-search');
  if(inp) inp.value='';
}


function reporteStockPrecios(){
  var tc=(DB.config&&DB.config.tipoCambio)||1;
  var empresa=(DB.config&&DB.config.empresa)||'Riego Adaptativo';
  var list=DB.componentes.slice().sort(function(a,b){var sa=(a.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();var sb=(b.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();return sa.localeCompare(sb,'es');});

  var totalCosto=0, totalVenta=0;
  var rows=list.map(function(c){
    var qty=stockActual(c.id);
    var costo=parseFloat(c.costo||c.precio)||0;
    var venta=parseFloat(c.venta)||0;
    var subtotalCosto=qty*costo;
    var subtotalVenta=qty*venta;
    totalCosto+=subtotalCosto;
    totalVenta+=subtotalVenta;
    var critico=qty<=(parseFloat(c.min)||0);
    return '<tr style="'+(critico?'background:#FFF3E0':'')+'">'+
      '<td>'+c.codigo+'</td>'+
      '<td>'+c.desc+'</td>'+
      '<td>'+(c.categoria||'—')+'</td>'+
      '<td style="text-align:center;font-weight:700;color:'+(critico?'#B71C1C':'#222')+'">'+qty+'</td>'+
      '<td style="text-align:right">$'+Math.round(costo).toLocaleString('es-AR')+'</td>'+
      '<td style="text-align:right;color:#666">'+(tc>1?'U$S '+(costo/tc).toFixed(2):'—')+'</td>'+
      '<td style="text-align:right">$'+Math.round(venta).toLocaleString('es-AR')+'</td>'+
      '<td style="text-align:right;color:#666">'+(tc>1?'U$S '+(venta/tc).toFixed(2):'—')+'</td>'+
      '<td style="text-align:right">$'+Math.round(subtotalCosto).toLocaleString('es-AR')+'</td>'+
      '<td style="text-align:right">$'+Math.round(subtotalVenta).toLocaleString('es-AR')+'</td>'+
    '</tr>';
  }).join('');

  var margen=totalCosto>0?((totalVenta-totalCosto)/totalCosto*100).toFixed(1):0;

  var css='*{box-sizing:border-box;margin:0;padding:0}body{font-family:Segoe UI,Arial,sans-serif;padding:20px;font-size:11px}'+
    'h1{font-size:15px;color:#256282;margin-bottom:2px}.meta{color:#666;font-size:10px;margin-bottom:12px}'+
    '.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}'+
    '.stat{background:#f5f5f5;border-radius:5px;padding:9px;text-align:center}'+
    '.stat .n{font-size:13px;font-weight:700;margin-bottom:2px}.stat .l{font-size:9px;color:#888;text-transform:uppercase}'+
    'table{width:100%;border-collapse:collapse}'+
    'th{background:#256282;color:#fff;padding:6px 8px;font-size:9px;text-align:left}'+
    'td{padding:5px 8px;border-bottom:1px solid #eee}'+
    'tfoot td{background:#222;color:#fff;font-weight:700;padding:7px 8px}'+
    '.btn{position:fixed;top:12px;right:12px;background:#256282;color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer}'+
    '@media print{.btn{display:none}@page{margin:10mm}}';

  var w=window.open('','_blank');
  w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Stock con precios</title><style>'+css+'</style></head><body>'+
    '<button class="btn" onclick="window.print()">🖨️ Imprimir</button>'+
    '<h1>STOCK CON PRECIOS DE COSTO Y VENTA</h1>'+
    '<div class="meta">'+empresa+' · '+today()+(tc>1?' · TC U$S: $'+tc:'')+'</div>'+
    '<div class="stats">'+
      '<div class="stat"><div class="n">'+list.length+'</div><div class="l">Componentes</div></div>'+
      '<div class="stat"><div class="n" style="color:#256282">$'+Math.round(totalCosto).toLocaleString('es-AR')+'</div><div class="l">Valor a costo</div></div>'+
      '<div class="stat"><div class="n" style="color:green">$'+Math.round(totalVenta).toLocaleString('es-AR')+'</div><div class="l">Valor a venta</div></div>'+
      '<div class="stat"><div class="n">'+margen+'%</div><div class="l">Margen promedio</div></div>'+
    '</div>'+
    '<table><thead><tr>'+
      '<th>Código</th><th>Descripción</th><th>Categoría</th>'+
      '<th style="text-align:center">Stock</th>'+
      '<th style="text-align:right">Costo $</th>'+
      '<th style="text-align:right">Costo U$S</th>'+
      '<th style="text-align:right">Venta $</th>'+
      '<th style="text-align:right">Venta U$S</th>'+
      '<th style="text-align:right">Total costo</th>'+
      '<th style="text-align:right">Total venta</th>'+
    '</tr></thead>'+
    '<tbody>'+rows+'</tbody>'+
    '<tfoot><tr>'+
      '<td colspan="8" style="text-align:right;padding:7px 8px">TOTALES</td>'+
      '<td style="text-align:right;padding:7px 8px">$'+Math.round(totalCosto).toLocaleString('es-AR')+'</td>'+
      '<td style="text-align:right;padding:7px 8px;color:#81C784">$'+Math.round(totalVenta).toLocaleString('es-AR')+'</td>'+
    '</tr></tfoot></table>'+
    '</body></html>');
  w.document.close();
}


// ACTA DE CONFORMIDAD =====================================
function renderActa(){
  const c = gc();
  const el = document.getElementById('cont-acta');
  if(!el) return;
  if(c.estado==='Potencial'){el.innerHTML=potencialLockMsg();return;}
  const numActa = 'ACR-'+new Date().getFullYear()+'-'+String(c.id).padStart(4,'0');
  
  el.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">'+
      '<div>'+
        '<div style="font-size:12px;color:var(--text2)">Acta N°: <strong>'+numActa+'</strong></div>'+
        '<div style="font-size:12px;color:var(--text2)">Cliente: <strong>'+c.nombre+'</strong></div>'+
        '<div style="font-size:12px;color:var(--text2)">Modelo: <strong>'+(c.modelo||'AquaOne')+'</strong></div>'+
      '</div>'+
      '<button class="btn btn-p" onclick="generarPDFActa('+c.id+')">📄 Generar acta PDF</button>'+
    '</div>'+
    '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);padding:12px;font-size:12px;color:var(--text2);margin-bottom:12px">'+
      'El acta de recepción y conformidad certifica que el cliente recibió el sistema instalado y funcionando correctamente. '+
      'Su firma da inicio al período de garantía.'+
    '</div>'+
    '<hr class="div">'+
    '<div class="sectitle" style="margin-bottom:10px">Garantía</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">'+
      '<div class="fg" style="margin:0"><label>Duración de garantía</label>'+
        '<input id="acta-garantia" value="'+(c.actaGarantia||'12 meses')+'" placeholder="Ej: 12 meses, 6 meses..." '+
        'onblur="saveActaDatos('+c.id+')"></div>'+
      '<div class="fg" style="margin:0"><label>Alcance</label>'+
        '<input id="acta-garantia-alcance" value="'+(c.actaGarantiaAlcance||'Materiales y mano de obra')+'" placeholder="Ej: Materiales y mano de obra" '+
        'onblur="saveActaDatos('+c.id+')"></div>'+
    '</div>'+
    '<hr class="div">'+
    '<div class="sectitle" style="margin-bottom:10px">Archivo del acta firmada</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
      '<div class="fg" style="margin:0"><label>N° de archivo físico</label>'+
        '<input id="acta-numfisico" value="'+(c.actaNumFisico||'')+'" placeholder="Ej: ACT-2026-001" '+
        'onblur="saveActaDatos('+c.id+')"></div>'+
      '<div class="fg" style="margin:0"><label>Fecha de firma</label>'+
        '<input id="acta-fechafirma" type="date" value="'+(c.actaFechaFirma||'')+'" '+
        'onchange="saveActaDatos('+c.id+')"></div>'+
      '<div class="fg" style="grid-column:1/-1;margin:0"><label>Link al archivo en Drive / OneDrive</label>'+
        '<input id="acta-link" value="'+(c.actaLink||'')+'" placeholder="https://drive.google.com/..." '+
        'onblur="saveActaDatos('+c.id+')"></div>'+
      '<div class="fg" style="grid-column:1/-1;margin:0"><label>Observaciones del acta</label>'+
        '<input id="acta-obs" value="'+(c.actaObs||'')+'" placeholder="Ej: Firmada por propietario, copia entregada..." '+
        'onblur="saveActaDatos('+c.id+')"></div>'+
    '</div>'+
    (c.actaLink?'<div style="margin-top:10px"><a href="'+c.actaLink+'" target="_blank" class="btn btn-sm" style="color:var(--blue);border-color:var(--blue)">☁️ Abrir archivo en Drive</a></div>':'');
}

function saveActaDatos(cid){
  var c = DB.clientes.find(function(x){return x.id===cid;});
  if(!c) return;
  var g = function(id){var el=document.getElementById(id);return el?el.value:'';};
  c.actaNumFisico = g('acta-numfisico');
  c.actaFechaFirma = g('acta-fechafirma');
  c.actaLink = g('acta-link');
  c.actaObs = g('acta-obs');
  save();
}

function generarPDFActa(cid){
  const c = DB.clientes.find(function(x){return x.id===cid;});
  if(!c) return;
  const empresa = (DB.config&&DB.config.empresa)||'Riego Adaptativo';
  const tel = (DB.config&&DB.config.tel)||'';
  const email = (DB.config&&DB.config.email)||'';
  const web = (DB.config&&DB.config.web)||'';
  const numActa = 'ACR-'+new Date().getFullYear()+'-'+String(c.id).padStart(4,'0');
  const fecha = today();
  var garantiaDur = c.actaGarantia||'12 meses';
  var garantiaAlc = c.actaGarantiaAlcance||'materiales y mano de obra';
  var garantia = garantiaDur+' — '+garantiaAlc;

  // Sensores de riego instalados (internamente: "zigbee")
  var zigbeeRows = '';
  if(c.zigbee&&c.zigbee.length){
    zigbeeRows = c.zigbee.map(function(d){
      return '<tr><td>'+d.tipo+'</td><td>'+d.nombre+'</td><td>'+(d.ubicacion||'—')+'</td></tr>';
    }).join('');
  } else {
    zigbeeRows = '<tr><td colspan="3" style="color:#999;font-style:italic">Sin dispositivos registrados</td></tr>';
  }

  var css = '*{box-sizing:border-box;margin:0;padding:0}'+
    'body{font-family:Segoe UI,Arial,sans-serif;padding:0;font-size:12px;color:#222}'+
    '.header{background:#0D1B24;color:#fff;padding:14px 24px;display:flex;align-items:center;justify-content:space-between}'+
    '.header h1{font-size:16px;font-weight:700;color:#fff}'+
    '.header .sub{font-size:10px;color:#aaa;margin-top:2px}'+
    '.acta-num{font-size:20px;font-weight:700;color:#256282;text-align:right}'+
    '.body{padding:20px 24px}'+
    '.section{margin-bottom:18px}'+
    '.section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#256282;border-bottom:2px solid #256282;padding-bottom:3px;margin-bottom:10px}'+
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}'+
    '.field{background:#f8f8f8;border-radius:4px;padding:6px 10px}'+
    '.field .l{font-size:9px;color:#999;font-weight:700;text-transform:uppercase;margin-bottom:1px}'+
    '.field .v{font-size:12px;font-weight:500}'+
    'table{width:100%;border-collapse:collapse;margin-top:4px}'+
    'th{background:#256282;color:#fff;padding:6px 10px;font-size:10px;text-align:left;font-weight:700}'+
    'td{padding:6px 10px;border-bottom:1px solid #eee;font-size:11px}'+
    '.declaracion{background:#FFF8E1;border:1px solid #FFD54F;border-radius:5px;padding:12px 14px;font-size:11px;line-height:1.6;margin-bottom:18px}'+
    '.firmas{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:10px}'+
    '.firma-box{border-top:2px solid #222;padding-top:8px}'+
    '.firma-label{font-size:10px;color:#666;margin-bottom:4px;font-weight:700;text-transform:uppercase}'+
    '.firma-line{font-size:11px;color:#444;margin-bottom:3px}'+
    '.footer{background:#f5f5f5;border-top:3px solid #256282;padding:10px 24px;font-size:9px;color:#888;display:flex;justify-content:space-between}'+
    '.btn{position:fixed;top:12px;right:12px;background:#256282;color:#fff;border:none;padding:7px 16px;border-radius:6px;cursor:pointer;font-size:11px}'+
    '@media print{.btn{display:none}@page{margin:0}}';

  var body =
    '<button class="btn" onclick="window.print()">🖨️ Imprimir</button>'+
    '<div class="header">'+
      '<div><div class="sub">ACTA DE RECEPCIÓN Y CONFORMIDAD</div><h1>'+empresa.toUpperCase()+'</h1></div>'+
      '<div class="acta-num">'+numActa+'<div style="font-size:11px;font-weight:400;color:#aaa;text-align:right">Fecha: '+fecha+'</div></div>'+
    '</div>'+
    '<div class="body">'+

    '<div class="section">'+
      '<div class="section-title">Datos del cliente</div>'+
      '<div class="grid">'+
        '<div class="field"><div class="l">Nombre</div><div class="v">'+c.nombre+'</div></div>'+
        '<div class="field"><div class="l">Domicilio</div><div class="v">'+(c.lote||'—')+(c.barrio?', '+c.barrio:'')+'</div></div>'+
        '<div class="field"><div class="l">Teléfono</div><div class="v">'+(c.tel||'—')+'</div></div>'+
        '<div class="field"><div class="l">Email</div><div class="v">'+(c.email||'—')+'</div></div>'+
      '</div>'+
    '</div>'+

    '<div class="section">'+
      '<div class="section-title">Sistema instalado</div>'+
      '<div class="grid">'+
        '<div class="field"><div class="l">Modelo</div><div class="v">'+(c.modelo||'AquaOne')+'</div></div>'+
        '<div class="field"><div class="l">Versión firmware</div><div class="v">'+(c.version||'—')+'</div></div>'+
        '<div class="field"><div class="l">N° de serie</div><div class="v">'+(c.equipo&&c.equipo.esp_serie||'—')+'</div></div>'+
        '<div class="field"><div class="l">Fecha de instalación</div><div class="v">'+(c.fecha||fecha)+'</div></div>'+
        '<div class="field"><div class="l">Técnico instalador</div><div class="v">___________________________</div></div>'+
        '<div class="field"><div class="l">Garantía</div><div class="v">'+garantia+'</div></div>'+
      '</div>'+
    '</div>'+

    '<div class="section">'+
      '<div class="section-title">Dispositivos instalados</div>'+
      '<table><thead><tr><th>Tipo</th><th>Nombre / Ubicación</th><th>Sector</th></tr></thead>'+
      '<tbody>'+zigbeeRows+'</tbody></table>'+
    '</div>'+

    '<div class="declaracion">'+
      '<strong>DECLARACIÓN DE CONFORMIDAD</strong><br><br>'+
      'El/la Sr./Sra. <strong>'+c.nombre+'</strong>, en carácter de titular del inmueble ubicado en '+
      (c.lote||'el domicilio indicado')+(c.barrio?', '+c.barrio:'')+', declara haber recibido el sistema de riego '+
      (c.modelo||'AquaOne')+' instalado y en correcto funcionamiento, habiendo verificado personalmente '+
      'la operación de todos los dispositivos listados y recibido la capacitación necesaria para su uso.<br><br>'+
      'A partir de la fecha de firma del presente documento comienza a regir el período de <strong>garantía de '+garantia+'</strong>.'+
    '</div>'+

    '<div class="section">'+
      '<div class="section-title">Firmas</div>'+
      '<div class="firmas">'+
        '<div class="firma-box">'+
          '<div class="firma-label">Cliente</div>'+
          '<div style="height:50px"></div>'+
          '<div class="firma-line">Nombre: '+c.nombre+'</div>'+
          '<div class="firma-line">DNI: ___________________________</div>'+
          '<div class="firma-line">Fecha: '+fecha+'</div>'+
        '</div>'+
        '<div class="firma-box">'+
          '<div class="firma-label">'+empresa+'</div>'+
          '<div style="height:50px"></div>'+
          '<div class="firma-line">Técnico: ___________________________</div>'+
          '<div class="firma-line">Fecha: '+fecha+'</div>'+
        '</div>'+
      '</div>'+
    '</div>'+

    '</div>'+
    '<div class="footer">'+
      '<div>'+empresa+(tel?' · '+tel:'')+(email?' · '+email:'')+(web?' · '+web:'')+'</div>'+
      '<div>'+numActa+' · Sistema Administrativo Riego Adaptativo</div>'+
    '</div>';

  var w=window.open('','_blank');
  w.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Acta '+numActa+'</title><style>'+css+'</style></head><body>'+body+'</body></html>');
  w.document.close();
}


function reporteOCporProveedor(){
  var tc=(DB.config&&DB.config.tipoCambio)||1;
  var provMap={};
  DB.ordenes.forEach(function(o){
    var prov=o.proveedor||'Sin proveedor';
    if(!provMap[prov]) provMap[prov]={ordenes:[],total:0};
    var total=o.items.reduce(function(a,i){
      var c=DB.componentes.find(function(x){return x.id===i.cid;})||{costo:0,precio:0};
      return a+(c.costo||c.precio||0)*i.cant;
    },0);
    provMap[prov].ordenes.push({numero:o.numero||'—',fecha:o.fecha,estado:o.estado,total:total});
    provMap[prov].total+=total;
  });

  if(!Object.keys(provMap).length){
    reporteContainer('🛒 OC por proveedor','<div class="empty">Sin órdenes de compra.</div>');
    return;
  }

  var h='';
  Object.entries(provMap).sort(function(a,b){return b[1].total-a[1].total;}).forEach(function(entry){
    var prov=entry[0], data=entry[1];
    h += '<div class="card" style="margin-bottom:10px">'+
      '<div class="ch"><div class="ct">🏭 '+prov+'</div>'+
      '<div style="font-size:12px;font-weight:700">$'+Math.round(data.total).toLocaleString('es-AR')+'</div></div>'+
      '<div class="card-body">'+
      '<table style="width:100%;border-collapse:collapse">'+
      '<thead><tr style="background:var(--surface2)"><th style="padding:5px 10px;font-size:10px">N° OC</th><th style="padding:5px 10px;font-size:10px">Fecha</th><th style="padding:5px 10px;font-size:10px">Estado</th><th style="padding:5px 10px;font-size:10px;text-align:right">Total</th></tr></thead>'+
      '<tbody>'+data.ordenes.map(function(o){
        return '<tr style="border-bottom:1px solid var(--border)">'+
          '<td style="padding:5px 10px;font-family:monospace">'+o.numero+'</td>'+
          '<td style="padding:5px 10px;font-size:11px">'+o.fecha+'</td>'+
          '<td style="padding:5px 10px"><span class="pill p-b">'+o.estado+'</span></td>'+
          '<td style="padding:5px 10px;text-align:right;font-weight:700">$'+Math.round(o.total).toLocaleString('es-AR')+'</td>'+
        '</tr>';
      }).join('')+'</tbody></table>'+
      '</div></div>';
  });

  reporteContainer('🛒 OC por proveedor', h);
}



// =======================================================
// FABRICACION
// =======================================================

function getLineaOT(f){ return (DB.lineasProducto||[]).find(function(l){return l.id===f.lineaId;}); }

// Numeración genérica para cualquier línea de producto
function getNumOT(linea, lote){
  var prefijo = (linea.nombre||'OT').replace(/[^a-zA-Z0-9]/g,'').slice(0,4).toUpperCase();
  var now = new Date();
  var aa = String(now.getFullYear()).slice(2);
  var mm = String(now.getMonth()+1).padStart(2,'0');
  var ll = String(lote).padStart(2,'0');
  var enLote = (DB.fabricacion||[]).filter(function(f){return f.lote===parseInt(lote)&&f.lineaId===linea.id;}).length;
  var nnn = String(enLote+1).padStart(3,'0');
  return 'OT-'+prefijo+aa+mm+'-'+ll+'-'+nnn;
}

function renderFabricacion(){
  if(!DB.fabricacion) DB.fabricacion=[];
  var q=(document.getElementById('q-fab')?document.getElementById('q-fab').value||'':'').toLowerCase();
  var fest=document.getElementById('fab-estado-filter')?document.getElementById('fab-estado-filter').value:'';

  var lista=DB.fabricacion.filter(function(f){
    return (!q||(f.nserie+(f.cliente||'')+f.modelo).toLowerCase().includes(q)) &&
           (!fest||f.estado===fest);
  }).sort(function(a,b){return (b.fecha||'').localeCompare(a.fecha||'');});

  var pendiente=(DB.fabricacion||[]).filter(function(f){return f.estado==='Pendiente';}).length;
  var enFab=(DB.fabricacion||[]).filter(function(f){return f.estado==='En fabricación';}).length;
  var term=(DB.fabricacion||[]).filter(function(f){return f.estado==='Terminado';}).length;
  var entregados=(DB.fabricacion||[]).filter(function(f){return f.estado==='Entregado';}).length;

  var el=document.getElementById('fab-stats');
  if(el) el.innerHTML=
    '<div class="stat"><div class="stat-n amber">'+pendiente+'</div><div class="stat-l">Pendientes</div></div>'+
    '<div class="stat"><div class="stat-n blue">'+enFab+'</div><div class="stat-l">En fabricación</div></div>'+
    '<div class="stat"><div class="stat-n green">'+term+'</div><div class="stat-l">Terminados</div></div>'+
    '<div class="stat"><div class="stat-n">'+entregados+'</div><div class="stat-l">Entregados</div></div>';

  var tb=document.getElementById('tbody-fab');
  if(!lista.length){tb.innerHTML='<tr><td colspan="8" class="empty">Sin órdenes de trabajo.</td></tr>';return;}

  tb.innerHTML=lista.map(function(f){
    var linea=getLineaOT(f)||{fases:[],nombre:'—'};
    var etapaActual=linea.fases.find(function(e){return e.id===f.etapaActual;})||linea.fases[0]||{nombre:'—'};
    var etapaIdx=linea.fases.findIndex(function(e){return e.id===f.etapaActual;});
    var pct=f.estado==='Pendiente'?0:f.estado==='Terminado'||f.estado==='Entregado'?100:(linea.fases.length?Math.round((etapaIdx/linea.fases.length)*100):0);
    var estadoColor=f.estado==='Pendiente'?'p-a':f.estado==='En fabricación'?'p-b':f.estado==='Terminado'||f.estado==='Entregado'?'p-g':'p-r';
    return '<tr>'+
      '<td style="font-family:monospace;font-size:11px;font-weight:700">'+f.nserie+'</td>'+
      '<td>'+'<span class="pill p-x">'+linea.nombre+'</span>'+'</td>'+
      '<td style="text-align:center">'+f.lote+'</td>'+
      '<td style="font-size:11px">'+(f.cliente||'Stock')+'</td>'+
      '<td>'+
        '<div style="font-size:10px;color:var(--text2);margin-bottom:2px">'+(f.estado==='Pendiente'?'No iniciado':etapaActual.nombre)+'</div>'+
        '<div style="background:var(--surface2);border-radius:3px;height:5px;overflow:hidden">'+
          '<div style="height:100%;background:var(--brand);width:'+pct+'%"></div>'+
        '</div>'+
      '</td>'+
      '<td><span class="pill '+estadoColor+'">'+f.estado+'</span></td>'+
      '<td style="font-size:11px">'+(f.fecha||'—')+'</td>'+
      '<td style="display:flex;gap:3px"><button class="btn btn-sm btn-p" onclick="abrirOT('+f.id+')">📋 Ver</button><button class="btn btn-sm" style="color:var(--red)" onclick="borrarOT('+f.id+')">🗑️</button></td>'+
    '</tr>';
  }).join('');
}

function modalNuevaOT(){
  if(!DB.fabricacion) DB.fabricacion=[];
  var presList=DB.presupuestos.filter(function(p){return p.estado==='Aprobado';});
  var loteMax=(DB.fabricacion||[]).reduce(function(a,f){return Math.max(a,f.lote||0);},0);
  var lineas=DB.lineasProducto||[];

  if(!lineas.length){ alert('No hay ninguna línea de producto configurada. Cargá al menos una en "Líneas de producto" antes de crear una OT.'); return; }

  openModal('Nueva orden de trabajo',
    '<div class="fg2">'+
      '<div class="fg full"><label>Línea de producto</label>'+
        '<select id="ot-linea" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
          lineas.map(function(l){return '<option value="'+l.id+'">'+l.nombre+'</option>';}).join('')+
        '</select></div>'+
      '<div class="fg"><label>Origen</label>'+
        '<select id="ot-origen" onchange="toggleOTCliente()" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
          '<option value="manual">Manual (para stock)</option>'+
          '<option value="presupuesto">Desde presupuesto aprobado</option>'+
        '</select></div>'+
      '<div class="fg" id="ot-pres-wrap" style="display:none"><label>Presupuesto / Cliente</label>'+
        '<select id="ot-presupuesto" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
          '<option value="">-- seleccionar --</option>'+
          presList.map(function(p){return '<option value="'+p.id+'">'+presNum(p)+' — '+p.nombre+'</option>';}).join('')+
        '</select></div>'+
      '<div class="fg"><label>N° de lote</label>'+
        '<input id="ot-lote" type="number" min="1" value="'+(loteMax+1)+'"></div>'+
      '<div class="fg full"><label>Observaciones</label>'+
        '<input id="ot-obs" placeholder="Observaciones..."></div>'+
    '</div>',
    function(){
      var lineaId=parseInt(document.getElementById('ot-linea').value);
      var linea=(DB.lineasProducto||[]).find(function(l){return l.id===lineaId;});
      if(!linea){alert('Seleccioná una línea de producto.');return false;}
      if(!linea.fases||!linea.fases.length){alert('Esta línea de producto todavía no tiene fases configuradas.');return false;}
      var lote=parseInt(document.getElementById('ot-lote').value)||1;
      var origen=document.getElementById('ot-origen').value;
      var presId=origen==='presupuesto'?(parseInt(document.getElementById('ot-presupuesto').value)||null):null;
      var pres=presId?DB.presupuestos.find(function(p){return p.id===presId;}):null;
      var cliente=pres?pres.nombre:'';
      var nserie=getNumOT(linea,lote);

      // Buscar cliente dado de alta
      var clienteObj=pres?DB.clientes.find(function(c){return c.nombre===pres.nombre;}):null;

      var ot={
        id:DB.nid++,
        lineaId:lineaId,
        nserie:nserie,
        lote:lote,
        cliente:cliente,
        clienteId:clienteObj?clienteObj.id:null,
        presId:presId||null,
        fecha:today(),
        estado:'Pendiente',
        etapaActual:linea.fases[0].id,
        obs:document.getElementById('ot-obs').value,
        etapas:{},
        materiales:[],
        kitConsumido:false,
        instalacionGenerada:false,
        fechaInicio:''
      };

      // Initialize etapas dinámicamente según la línea elegida
      linea.fases.forEach(function(e){
        ot.etapas[e.id]={completada:false,fecha:'',responsable:'',obs:'',ops:{}};
        e.ops.forEach(function(op){ot.etapas[e.id].ops[op]=false;});
      });

      // Set cliente estado to Programado
      if(clienteObj){
        clienteObj.estadoInstalacion='Programado';
      }

      DB.fabricacion.push(ot);
      save();
      renderFabricacion();
      alert('OT creada: '+nserie+'\nLínea: '+linea.nombre+'\nEstado: Pendiente de inicio.'+(clienteObj?'\nCliente actualizado a: Programado':''));
      return true;
    }
  );
}

function toggleOTCliente(){
  var origen=document.getElementById('ot-origen').value;
  var wrap=document.getElementById('ot-pres-wrap');
  if(wrap) wrap.style.display=origen==='presupuesto'?'':'none';
}

function iniciarFabricacion(otId){
  var f=DB.fabricacion.find(function(x){return x.id===otId;});
  if(!f) return;
  var linea=getLineaOT(f);
  if(!linea){ alert('La línea de producto de esta OT ya no existe.'); return; }

  // Verificar stock vs kit de la línea
  var kit=linea.kit||[];
  var faltantes=[];
  kit.forEach(function(item){
    var disponible=stockActual(item.compId);
    if(disponible<item.cant){
      var comp=DB.componentes.find(function(c){return c.id===item.compId;})||{};
      faltantes.push({nombre:comp.desc||item.compNombre,necesita:item.cant,tiene:disponible});
    }
  });

  if(faltantes.length){
    var msg='⚠️ Stock insuficiente para los siguientes materiales:\n\n';
    faltantes.forEach(function(f){msg+='• '+f.nombre+': necesita '+f.necesita+', hay '+f.tiene+'\n';});
    msg+='\n¿Iniciás la fabricación de todas formas?';
    if(!confirm(msg)) return;
  }

  if(!confirm('¿Confirmar inicio de fabricación para '+f.nserie+'?\nSe realizará la salida de materiales del kit al stock de fábrica.')) return;

  // Salida del stock al registro de materiales en fábrica
  f.materiales=[];
  kit.forEach(function(item){
    var comp=DB.componentes.find(function(c){return c.id===item.compId;})||{};
    // Stock movement - salida
    DB.movimientos.push({
      id:DB.nid++,
      compId:item.compId,
      fecha:today(),
      tipo:'Salida',
      motivo:'Fabricación — '+f.nserie,
      ref:f.nserie,
      cant:item.cant,
      precio:parseFloat(comp.costo||comp.precio)||0
    });
    // Register in materiales en fabrica
    f.materiales.push({
      compId:item.compId,
      compCodigo:comp.codigo||'',
      compNombre:comp.desc||item.compNombre||'',
      cant:item.cant,
      devuelto:0
    });
  });
  f.kitConsumido=true;

  f.estado='En fabricación';
  f.fechaInicio=today();

  // Update cliente estado
  if(f.clienteId){
    var clienteObj=DB.clientes.find(function(c){return c.id===f.clienteId;});
    if(clienteObj) clienteObj.estadoInstalacion='En fabricación';
  }

  save();
  cerrarModal();
  abrirOT(otId);
}

function abrirOT(id){
  var f=DB.fabricacion.find(function(x){return x.id===id;});
  if(!f) return;
  var linea=getLineaOT(f);

  var esPendiente=f.estado==='Pendiente';

  // Header info
  var headerHTML=
    '<div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">'+
      '<span style="font-family:monospace;font-weight:700;font-size:14px;color:var(--brand)">'+f.nserie+'</span>'+
      ('<span class="pill p-x">'+(linea?linea.nombre:'⚠️ línea eliminada')+'</span>')+
      '<span class="pill '+(f.estado==='Pendiente'?'p-a':f.estado==='En fabricación'?'p-b':'p-g')+'">'+f.estado+'</span>'+
      (f.cliente?'<span style="font-size:11px;color:var(--text2)">Cliente: '+f.cliente+'</span>':'')+
      '<span style="font-size:11px;color:var(--text2)">Lote '+f.lote+' · Creada '+f.fecha+'</span>'+
      (f.fechaInicio?'<span style="font-size:11px;color:var(--text2)">Iniciada '+f.fechaInicio+'</span>':'')+
    '</div>';

  if(!linea){
    openModal('OT — '+f.nserie, headerHTML+'<div class="card-body" style="color:var(--red)">⚠️ La línea de producto de esta OT fue eliminada. No se puede continuar con la fabricación desde acá.</div>', null, true);
    return;
  }

  // Boton iniciar
  var iniciarHTML='';
  if(esPendiente){
    var kitInfo=linea.kit&&linea.kit.length?'Al iniciar se realizará la salida del kit del stock ('+linea.kit.length+' ítem'+(linea.kit.length!==1?'s':'')+').':'Esta línea no tiene kit de materiales cargado — se puede iniciar igual.';
    iniciarHTML='<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);padding:14px;margin-bottom:12px;text-align:center">'+
      '<div style="font-size:13px;margin-bottom:10px;color:var(--text2)">OT pendiente de inicio. '+kitInfo+'</div>'+
      '<button class="btn btn-p" style="font-size:13px;padding:8px 20px" onclick="iniciarFabricacion('+id+')">▶️ Iniciar fabricación</button>'+
    '</div>';
  }

  // Materiales en fabrica
  var matHTML='';
  if(f.materiales&&f.materiales.length){
    matHTML='<div class="card" style="margin-bottom:10px">'+
      '<div class="ch"><div class="ct">📦 Materiales en fábrica — '+f.nserie+'</div>'+
      '<button class="btn btn-sm" onclick="agregarMaterialExtra('+id+')">➕ Consumo adicional</button>'+
      '<button class="btn btn-sm" onclick="devolverMaterial('+id+')">↩️ Devolver</button>'+
      '</div>'+
      '<div class="card-body">'+
      '<table style="width:100%;border-collapse:collapse">'+
      '<thead><tr style="background:var(--surface2)">'+
        '<th style="padding:5px 10px;font-size:10px">Código</th>'+
        '<th style="padding:5px 10px;font-size:10px">Componente</th>'+
        '<th style="padding:5px 10px;font-size:10px;text-align:center">Asignado</th>'+
        '<th style="padding:5px 10px;font-size:10px;text-align:center">Devuelto</th>'+
        '<th style="padding:5px 10px;font-size:10px;text-align:center">En uso</th>'+
      '</tr></thead><tbody>'+
      f.materiales.map(function(m){
        var enUso=m.cant-(m.devuelto||0);
        return '<tr style="border-bottom:1px solid var(--border)">'+
          '<td style="padding:5px 10px;font-family:monospace;font-size:11px">'+(function(){var c=DB.componentes.find(function(x){return x.id===m.compId;});return c?c.codigo:m.compCodigo||'—';})()+'</td>'+
          '<td style="padding:5px 10px;font-size:11px">'+(function(){var c=DB.componentes.find(function(x){return x.id===m.compId;});return c?c.desc:m.compNombre||'—';})()+'</td>'+
          '<td style="padding:5px 10px;text-align:center">'+m.cant+'</td>'+
          '<td style="padding:5px 10px;text-align:center;color:var(--text2)">'+(m.devuelto||0)+'</td>'+
          '<td style="padding:5px 10px;text-align:center;font-weight:700">'+enUso+'</td>'+
        '</tr>';
      }).join('')+'</tbody></table></div></div>';
  }

  // Pedido de instalación — manual, cuando la OT ya está Terminada y tiene cliente
  var instalHTML='';
  if(f.estado==='Terminado' && f.clienteId){
    var yaExiste=(DB.instalaciones||[]).some(function(p){return p.otId===f.id;});
    instalHTML = yaExiste
      ? '<div style="background:var(--surface2);border:1px solid var(--green);border-radius:var(--r);padding:12px;margin-bottom:12px;color:var(--green);font-size:13px">✓ Pedido de instalación ya generado para esta OT.</div>'
      : '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);padding:14px;margin-bottom:12px;text-align:center">'+
          '<div style="font-size:13px;margin-bottom:10px;color:var(--text2)">OT terminada con cliente vinculado — se puede generar el pedido de instalación cuando quieras.</div>'+
          '<button class="btn btn-p" style="font-size:13px;padding:8px 20px" onclick="generarPedidoInstalacionManual('+id+')">🚚 Generar pedido de instalación</button>'+
        '</div>';
  }

  // Etapas
  var etapaActualIdx=linea.fases.findIndex(function(e){return e.id===f.etapaActual;});
  var etapasHTML=!esPendiente?linea.fases.map(function(e,ei){
    var et=f.etapas[e.id]||{completada:false,fecha:'',responsable:'',obs:'',ops:{}};
    var esActual=e.id===f.etapaActual&&f.estado==='En fabricación';
    var completada=et.completada;
    var bloqueada=ei>etapaActualIdx&&!completada;

    var opsHTML=e.ops.map(function(op,oi){
      var checked=et.ops[op]?'checked':'';
      var disabled=bloqueada||completada?'disabled':'';
      return '<div class="fab-checklist-item'+(et.ops[op]?' done':'')+'">'+
        '<input type="checkbox" '+checked+' '+disabled+' onchange="toggleOpFab('+id+',\''+e.id+'\',\''+op.replace(/\'/g,"\\'")+'\')">'+
        '<span class="fab-checklist-num">'+(oi+1)+'.</span>'+
        '<span class="fab-checklist-desc">'+op+'</span>'+
      '</div>';
    }).join('');

    var borderColor=completada?'var(--green)':esActual?'var(--brand)':'var(--border)';
    var icon=completada?'✅':esActual?'▶️':'⬜';

    // Warning de checklist obligatorio — solo en la etapa actual
    var checklistWarnHTML='';
    if(esActual && e.ops.length>0){
      var faltan=e.ops.filter(function(op){return !et.ops[op];});
      if(linea.checklistObligatorio){
        checklistWarnHTML = faltan.length>0
          ? '<div class="fab-warn-box">⚠️ Faltan tildar '+faltan.length+' tarea'+(faltan.length!==1?'s':'')+' para completar esta etapa:<br>'+faltan.map(function(op){return '• '+op;}).join('<br>')+'</div>'
          : '<div class="fab-ok-box">✓ Todas las tareas tildadas — ya podés completar esta etapa.</div>';
      } else {
        checklistWarnHTML = '<div class="fab-info-box">ℹ️ Checklist informativo en esta línea — no bloquea el avance. (Se activa en "Líneas de producto".)</div>';
      }
    }
    var bloqueadoPorChecklist = esActual && linea.checklistObligatorio && e.ops.filter(function(op){return !et.ops[op];}).length>0;

    return '<div class="fab-fase-item" style="border-left:3px solid '+borderColor+'">'+
      '<div class="fab-fase-head">'+
        '<span class="fab-fase-num">'+icon+' FASE '+(ei+1)+'</span>'+
        '<span class="fab-fase-nombre" style="color:'+(completada?'var(--green)':esActual?'var(--brand)':'var(--text2)')+'">'+e.nombre+'</span>'+
        (esActual?
          '<button class="btn btn-sm btn-g" '+(bloqueadoPorChecklist?'disabled':'')+' onclick="completarEtapaFab('+id+',\''+e.id+'\')">✔ Completar etapa</button>':
          '')+ 
        (completada?'<span style="font-size:11px;color:var(--green);white-space:nowrap">✅ '+et.fecha+(et.responsable?' · '+et.responsable:'')+'</span>':'')+
      '</div>'+
      '<div class="fab-fase-tareas">'+
        (e.ops.length?opsHTML:'<p class="fab-empty" style="padding:2px 0">Sin operaciones definidas.</p>')+
        (esActual?checklistWarnHTML:'')+
        (esActual?
          '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">'+
            '<input id="fab-resp-'+e.id+'" placeholder="Responsable" value="'+(et.responsable||'')+'" onblur="saveEtapaFields('+id+',\''+e.id+'\')" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;flex:1;min-width:120px">'+
            '<input id="fab-obs-'+e.id+'" placeholder="Observaciones de la etapa" value="'+(et.obs||'')+'" onblur="saveEtapaFields('+id+',\''+e.id+'\')" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;flex:2;min-width:180px">'+
          '</div>':'')+
      '</div></div>';
  }).join(''):'';

  openModal('OT — '+f.nserie, headerHTML+iniciarHTML+matHTML+instalHTML+etapasHTML, null, true);
}


function saveEtapaFields(otId, etapaId){
  var f=DB.fabricacion.find(function(x){return x.id===otId;});
  if(!f||!f.etapas[etapaId]) return;
  var respEl=document.getElementById('fab-resp-'+etapaId);
  var obsEl=document.getElementById('fab-obs-'+etapaId);
  if(respEl) f.etapas[etapaId].responsable=respEl.value;
  if(obsEl) f.etapas[etapaId].obs=obsEl.value;
  save();
}

function toggleOpFab(otId, etapaId, op){
  var f=DB.fabricacion.find(function(x){return x.id===otId;});
  if(!f||!f.etapas[etapaId]) return;
  f.etapas[etapaId].ops[op]=!f.etapas[etapaId].ops[op];
  save();
  abrirOT(otId); // re-renderiza para actualizar el warning y el estado del botón "Completar etapa"
}

function completarEtapaFab(otId, etapaId){
  var f=DB.fabricacion.find(function(x){return x.id===otId;});
  if(!f) return;
  var linea=getLineaOT(f);
  if(!linea) return;
  if(!f.etapas[etapaId]) f.etapas[etapaId]={completada:false,fecha:'',responsable:'',obs:'',ops:{}};

  var faseObj=linea.fases.find(function(e){return e.id===etapaId;});
  if(linea.checklistObligatorio && faseObj){
    var faltan=faseObj.ops.filter(function(op){return !f.etapas[etapaId].ops[op];});
    if(faltan.length>0){
      alert('No se puede completar esta etapa — faltan tildar:\n'+faltan.map(function(op){return '• '+op;}).join('\n'));
      return;
    }
  }

  var respEl=document.getElementById('fab-resp-'+etapaId);
  var obsEl=document.getElementById('fab-obs-'+etapaId);
  f.etapas[etapaId].responsable=respEl?respEl.value:'';
  f.etapas[etapaId].obs=obsEl?obsEl.value:'';
  f.etapas[etapaId].completada=true;
  f.etapas[etapaId].fecha=today();

  var etapaIdx=linea.fases.findIndex(function(e){return e.id===etapaId;});
  if(etapaIdx<linea.fases.length-1){
    f.etapaActual=linea.fases[etapaIdx+1].id;
  } else {
    f.estado='Terminado';
    f.etapaActual=linea.fases[linea.fases.length-1].id;
    if(f.clienteId){
      var clienteObj=DB.clientes.find(function(c){return c.id===f.clienteId;});
      if(clienteObj) clienteObj.estadoInstalacion='Terminado';
    }
    alert('✅ Fabricación terminada.'+(f.clienteId?' Cuando quieras, generá el pedido de instalación desde esta misma pantalla.':''));
  }

  save();
  renderFabricacion();
  cerrarModal();
  abrirOT(otId);
}

// Genera el pedido de instalación de forma manual (reemplaza la generación automática de antes).
// Arma el kit del pedido a partir del kit propio de la línea de producto.
function generarPedidoInstalacionManual(otId){
  var f=DB.fabricacion.find(function(x){return x.id===otId;});
  if(!f) return;
  var linea=getLineaOT(f);
  if(!linea) return;
  if(!f.clienteId){ alert('Esta OT no tiene cliente vinculado — no se puede generar un pedido de instalación.'); return; }
  if((DB.instalaciones||[]).some(function(p){return p.otId===f.id;})){ alert('Ya existe un pedido de instalación para esta OT.'); return; }

  var piNuevo = crearPedidoInstalacionSimple(f.id);
  if(!piNuevo) return;

  var matPendiente=(f.materiales||[]).filter(function(m){return m.cant>(m.devuelto||0);});
  if(matPendiente.length&&confirm('¿Hay materiales para devolver al stock?')){
    var msg='Seleccioná los materiales a devolver:\n\n';
    matPendiente.forEach(function(m){msg+='• '+m.compNombre+': '+(m.cant-(m.devuelto||0))+'\n';});
    if(confirm(msg+'\n¿Devolver todos al stock ahora?')){
      matPendiente.forEach(function(m){
        DB.movimientos.push({id:DB.nid++,compId:m.compId,fecha:today(),tipo:'Entrada',motivo:'Devolución fabricación '+f.nserie,ref:f.nserie,cant:m.cant-(m.devuelto||0),precio:0});
        m.devuelto=m.cant;
      });
      save();
    }
  }
  save();
  cerrarModal();
  abrirOT(otId);
  alert('✅ Pedido de instalación generado: '+piNuevo.numero);
}

// Arma el pedido de instalación con el kit propio de la línea de producto.
function crearPedidoInstalacionSimple(otId){
  var ot = (DB.fabricacion||[]).find(function(f){return f.id===otId;});
  if(!ot) return null;
  var linea=getLineaOT(ot);
  var cliente = DB.clientes.find(function(c){return c.id===ot.clienteId;})||null;

  var kitItems = (linea.kit||[]).map(function(item){
    var comp = DB.componentes.find(function(c){return c.id===item.compId;})||{};
    return {
      compId:item.compId,
      compCodigo:comp.codigo||'',
      compNombre:comp.desc||item.compNombre||'',
      cant:item.cant,
      unidad:comp.unidad||'',
      origen:'kit-linea',
      devuelto:0
    };
  });

  if(!DB.instalaciones) DB.instalaciones=[];
  var pi={
    id:DB.nid++,
    numero:getNumPI(),
    otId:ot.id,
    nserie:ot.nserie,
    clienteId:ot.clienteId,
    cliente:cliente?cliente.nombre:(ot.cliente||''),
    modelo:ot.modelo||linea.nombre,
    lineaId:linea.id,
    tecnico:'',
    fechaTentativa:'',
    estado:'Pendiente',
    kit:kitItems,
    fecha:today()
  };
  DB.instalaciones.push(pi);
  save();
  return pi;
}

function agregarMaterialExtra(otId){
  var f=DB.fabricacion.find(function(x){return x.id===otId;});
  if(!f) return;
  var compSel=[...DB.componentes].sort(function(a,b){var sa=(a.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();var sb=(b.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();return sa.localeCompare(sb,'es');}).map(function(c){
    return '<option value="'+c.id+'">'+c.codigo+' — '+c.desc+'</option>';
  }).join('');

  openModal('Consumo adicional de material',
    '<div class="fg2">'+
      '<div class="fg full"><label>Componente</label>'+
        '<select id="me-comp" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
          '<option value="">-- seleccionar --</option>'+compSel+
        '</select></div>'+
      '<div class="fg"><label>Cantidad</label><input id="me-cant" type="number" min="1" value="1"></div>'+
      '<div class="fg"><label>Motivo</label><input id="me-motivo" placeholder="Motivo del consumo adicional..."></div>'+
    '</div>',
    function(){
      var compId=parseInt(document.getElementById('me-comp').value)||0;
      var cant=parseFloat(document.getElementById('me-cant').value)||0;
      if(!compId||!cant){alert('Seleccioná componente y cantidad.');return false;}
      var comp=DB.componentes.find(function(c){return c.id===compId;})||{};
      // Stock salida
      DB.movimientos.push({
        id:DB.nid++, compId:compId, fecha:today(),
        tipo:'Salida', motivo:'Consumo adicional fabricación — '+f.nserie,
        ref:f.nserie, cant:cant,
        precio:parseFloat(comp.costo||comp.precio)||0
      });
      // Add to materiales
      var existing=f.materiales.find(function(m){return m.compId===compId;});
      if(existing){ existing.cant+=cant; }
      else { f.materiales.push({compId:compId,compCodigo:comp.codigo||'',compNombre:comp.desc||'',cant:cant,devuelto:0}); }
      save(); cerrarModal(); abrirOT(otId); return true;
    }
  );
}

function devolverMaterial(otId){
  var f=DB.fabricacion.find(function(x){return x.id===otId;});
  if(!f||!f.materiales||!f.materiales.length){alert('Sin materiales asignados.');return;}
  var disponibles=f.materiales.filter(function(m){return m.cant>(m.devuelto||0);});
  if(!disponibles.length){alert('No hay materiales para devolver.');return;}

  openModal('Devolver material al stock',
    '<div class="fg2">'+
      '<div class="fg full"><label>Componente</label>'+
        '<select id="dev-comp" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
          disponibles.map(function(m){
            return '<option value="'+m.compId+'">'+m.compCodigo+' — '+m.compNombre+' (en uso: '+(m.cant-(m.devuelto||0))+')</option>';
          }).join('')+
        '</select></div>'+
      '<div class="fg"><label>Cantidad a devolver</label><input id="dev-cant" type="number" min="1" value="1"></div>'+
    '</div>',
    function(){
      var compId=parseInt(document.getElementById('dev-comp').value);
      var cant=parseFloat(document.getElementById('dev-cant').value)||0;
      if(!cant) return false;
      var mat=f.materiales.find(function(m){return m.compId===compId;});
      if(!mat){return false;}
      var enUso=mat.cant-(mat.devuelto||0);
      if(cant>enUso){alert('No podés devolver más de lo que está en uso ('+enUso+').');return false;}
      mat.devuelto=(mat.devuelto||0)+cant;
      DB.movimientos.push({
        id:DB.nid++, compId:compId, fecha:today(),
        tipo:'Entrada', motivo:'Devolución fabricación — '+f.nserie,
        ref:f.nserie, cant:cant, precio:0
      });
      save(); cerrarModal(); abrirOT(otId); return true;
    }
  );
}


function borrarOT(id){
  var f=DB.fabricacion.find(function(x){return x.id===id;});
  if(!f) return;
  if(f.estado==='En fabricación'){
    if(!confirm('Esta OT está en fabricación. ¿Confirmar eliminación de todas formas?')) return;
  }
  if(!confirm('¿Eliminar la OT '+f.nserie+'? Esta acción no se puede deshacer.')) return;
  // Return materials to stock if any
  if(f.materiales&&f.materiales.length){
    var pendientes=f.materiales.filter(function(m){return m.cant>(m.devuelto||0);});
    if(pendientes.length){
      if(confirm('Hay materiales en fábrica. ¿Devolver al stock antes de eliminar?')){
        pendientes.forEach(function(m){
          DB.movimientos.push({
            id:DB.nid++,compId:m.compId,fecha:today(),
            tipo:'Entrada',motivo:'Devolución por cancelación OT '+f.nserie,
            ref:f.nserie,cant:m.cant-(m.devuelto||0),precio:0
          });
        });
      }
    }
  }
  DB.fabricacion=DB.fabricacion.filter(function(x){return x.id!==id;});
  // Remove linked PI if exists
  DB.instalaciones=(DB.instalaciones||[]).filter(function(p){return p.otId!==id;});
  save(); renderFabricacion();
}

// KIT DE FABRICACION =====================================
// =======================================================
// LÍNEAS DE PRODUCTO (reemplaza el kit global — DEV)
// =======================================================
var _lineasAbiertas={};

function renderLineasProducto(){
  if(!DB.lineasProducto) DB.lineasProducto=[];
  var el=document.getElementById('lineas-list');
  if(!el) return;
  if(!DB.lineasProducto.length){ el.innerHTML='<div class="empty">Sin líneas de producto todavía.</div>'; return; }

  el.innerHTML=DB.lineasProducto.map(function(l){
    var abierta=!!_lineasAbiertas[l.id];
    var nFases=l.fases.length;
    var nTareas=l.fases.reduce(function(a,f){return a+f.ops.length;},0);
    var kit=l.kit||[];
    return '<div class="fab-linea-card">'+
      '<div class="fab-linea-head" onclick="toggleLineaProducto('+l.id+')">'+
        '<div><div class="fab-linea-nombre">'+l.nombre+'</div>'+
          '<div class="fab-linea-meta">'+nFases+' fase'+(nFases!==1?'s':'')+' · '+nTareas+' tarea'+(nTareas!==1?'s':'')+' · '+kit.length+' ítem'+(kit.length!==1?'s':'')+' de kit · '+(l.itemsPresupuesto||[]).length+' ítem'+((l.itemsPresupuesto||[]).length!==1?'s':'')+' de presupuesto · checklist '+(l.checklistObligatorio?'obligatorio':'informativo')+'</div>'+
        '</div>'+
        '<div class="fab-linea-acts" onclick="event.stopPropagation()">'+
          '<button class="btn btn-sm" onclick="agregarFaseLinea('+l.id+')">➕ Fase</button>'+
          '<button class="btn btn-sm" onclick="abrirConfigPresupuesto('+l.id+')">⚙️ Presupuesto</button>'+
          '<button class="btn btn-sm" style="color:var(--red)" onclick="borrarLineaProducto('+l.id+')">🗑️</button>'+
          '<span style="cursor:pointer;padding:0 4px;font-size:12px;color:var(--text2)">'+(abierta?'▲':'▼')+'</span>'+
        '</div>'+
      '</div>'+
      (abierta?
      '<div class="fab-linea-body">'+
        '<div class="fab-section-block">'+
          '<div class="fab-section-title"><span>📝 DESCRIPCIÓN DEL PRODUCTO</span>'+
            '<button class="btn btn-sm" onclick="editarDescripcionLinea('+l.id+')">✏️ '+(l.descripcion?'Editar':'Agregar')+'</button>'+
          '</div>'+
          (l.descripcion?'<p style="font-size:12.5px;color:var(--text);white-space:pre-wrap;line-height:1.5">'+l.descripcion+'</p>':'<p class="fab-empty" style="padding:0">Sin descripción todavía.</p>')+
        '</div>'+

        '<label class="fab-toggle-row">'+
          '<input type="checkbox" '+(l.checklistObligatorio?'checked':'')+' onchange="toggleChecklistLinea('+l.id+')" style="margin:0;width:auto">'+
          'Exigir todas las tareas tildadas para poder completar una etapa'+
        '</label>'+

        '<div class="fab-section-block">'+
          '<div class="fab-section-title"><span>📦 KIT DE MATERIALES</span></div>'+
          (kit.length===0?'<p class="fab-empty">Sin materiales todavía.</p>':
            kit.map(function(k){
              var comp=DB.componentes.find(function(c){return c.id===k.compId;})||{};
              var stock=stockActual(k.compId);
              return '<div class="fab-kit-row">'+
                '<span style="flex:1">'+(comp.codigo?comp.codigo+' — ':'')+(comp.desc||k.compNombre||'—')+'</span>'+
                '<span style="color:var(--text2)">x'+k.cant+'</span>'+
                '<span style="color:var(--text2);font-size:11px">stock: '+stock+'</span>'+
                '<button class="fab-icon-btn" style="color:var(--red)" onclick="quitarKitItemLinea('+l.id+','+k.id+')">🗑️</button>'+
              '</div>';
            }).join('')
          )+
          '<button class="btn btn-sm" style="margin-top:10px" onclick="agregarKitItemLinea('+l.id+')">➕ Ítem al kit</button>'+
        '</div>'+

        '<div class="fab-section-block">'+
          '<div class="fab-section-title"><span>🔧 FASES</span></div>'+
          (nFases===0?'<p class="fab-empty">Sin fases todavía.</p>':
          l.fases.map(function(f,fi){
            return '<div class="fab-fase-item">'+
              '<div class="fab-fase-head">'+
                '<span class="fab-fase-num">FASE '+(fi+1)+'</span>'+
                '<span class="fab-fase-nombre">'+f.nombre+'</span>'+
                '<div class="fab-fase-acts">'+
                  '<button class="fab-icon-btn" onclick="moverFaseLinea('+l.id+',\''+f.id+'\',-1)" title="Subir">▲</button>'+
                  '<button class="fab-icon-btn" onclick="moverFaseLinea('+l.id+',\''+f.id+'\',1)" title="Bajar">▼</button>'+
                  '<button class="fab-icon-btn" onclick="editarFaseLinea('+l.id+',\''+f.id+'\')" title="Editar">✏️</button>'+
                  '<button class="fab-icon-btn" style="color:var(--red)" onclick="borrarFaseLinea('+l.id+',\''+f.id+'\')" title="Borrar">🗑️</button>'+
                '</div>'+
              '</div>'+
              '<div class="fab-fase-tareas">'+
                (f.ops.length===0?'<p class="fab-empty" style="padding:2px 0">Sin tareas todavía.</p>':f.ops.map(function(op,oi){
                  return '<div class="fab-tarea-row">'+
                    '<span class="fab-tarea-num">'+(oi+1)+'.</span>'+
                    '<span class="fab-tarea-desc">'+op+'</span>'+
                    '<div class="fab-tarea-acts">'+
                      '<button class="fab-icon-btn" onclick="moverTareaLinea('+l.id+',\''+f.id+'\','+oi+',-1)">▲</button>'+
                      '<button class="fab-icon-btn" onclick="moverTareaLinea('+l.id+',\''+f.id+'\','+oi+',1)">▼</button>'+
                      '<button class="fab-icon-btn" onclick="editarTareaLinea('+l.id+',\''+f.id+'\','+oi+')">✏️</button>'+
                      '<button class="fab-icon-btn" style="color:var(--red)" onclick="borrarTareaLinea('+l.id+',\''+f.id+'\','+oi+')">🗑️</button>'+
                    '</div>'+
                  '</div>';
                }).join(''))+
                '<button class="btn btn-sm" style="margin-top:8px" onclick="agregarTareaLinea('+l.id+',\''+f.id+'\')">➕ Tarea</button>'+
              '</div>'+
            '</div>';
          }).join(''))+
        '</div>'+
      '</div>':'');
  }).join('');
}

function crearLineaProducto(){
  var nombre=prompt('Nombre de la nueva línea de producto:');
  if(!nombre) return;
  DB.lineasProducto.push({id:DB.nid++, nombre:nombre, descripcion:'', checklistObligatorio:false, kit:[], fases:[], itemsPresupuesto:[]});
  save(); renderLineasProducto();
}

// ---- Configuración de presupuesto por línea de producto ----
function abrirConfigPresupuesto(lineaId){
  var l=DB.lineasProducto.find(function(x){return x.id===lineaId;});
  if(!l) return;
  if(!l.itemsPresupuesto) l.itemsPresupuesto=[];
  var items=l.itemsPresupuesto;
  var secciones=[];
  items.forEach(function(it){ if(secciones.indexOf(it.seccion)===-1) secciones.push(it.seccion); });

  var body='<p style="font-size:12.5px;color:var(--text2);margin-bottom:14px">Estos ítems van a aparecer en la tabla de precios al armar un presupuesto para "'+l.nombre+'". Agrupalos en secciones (ej: Equipamiento, Sensores, Mano de obra, Adicionales) — las que necesites.</p>'+
    '<button class="btn btn-p btn-sm" onclick="agregarItemPresupuesto('+l.id+')" style="margin-bottom:14px">➕ Agregar ítem</button>';

  if(!items.length){
    body+='<p class="fab-empty">Sin ítems todavía.</p>';
  } else {
    secciones.forEach(function(sec){
      body+='<div style="font-weight:700;font-size:11px;color:var(--text2);margin:12px 0 6px;letter-spacing:.3px">'+sec.toUpperCase()+'</div>';
      items.filter(function(it){return it.seccion===sec;}).forEach(function(it){
        body+='<div class="fab-kit-row">'+
          '<span style="flex:1">'+it.nombre+'</span>'+
          '<button class="fab-icon-btn" onclick="editarItemPresupuesto('+l.id+','+it.id+')">✏️</button>'+
          '<button class="fab-icon-btn" style="color:var(--red)" onclick="borrarItemPresupuesto('+l.id+','+it.id+')">🗑️</button>'+
        '</div>';
      });
    });
  }
  openModal('⚙️ Configuración de presupuesto — '+l.nombre, body, null, true);
}
function agregarItemPresupuesto(lineaId){
  var l=DB.lineasProducto.find(function(x){return x.id===lineaId;});
  var seccionesExistentes=[];
  (l.itemsPresupuesto||[]).forEach(function(it){ if(seccionesExistentes.indexOf(it.seccion)===-1) seccionesExistentes.push(it.seccion); });
  var datalistHTML='<datalist id="ip-secciones-dl">'+seccionesExistentes.map(function(s){return '<option value="'+s+'">';}).join('')+'</datalist>';

  openModal('➕ Agregar ítem de presupuesto',
    '<div class="fg2">'+
      '<div class="fg full"><label>Sección</label>'+
        '<input id="ip-seccion" type="text" list="ip-secciones-dl" placeholder="Elegí una existente o escribí una nueva" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
        datalistHTML+
        (seccionesExistentes.length?'<div style="font-size:11px;color:var(--text2);margin-top:4px">Ya existen: '+seccionesExistentes.join(', ')+'</div>':'')+
      '</div>'+
      '<div class="fg full"><label>Nombre del ítem</label>'+
        '<input id="ip-nombre" type="text" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%"></div>'+
    '</div>',
    function(){
      var seccion=document.getElementById('ip-seccion').value.trim();
      var nombre=document.getElementById('ip-nombre').value.trim();
      if(!seccion){ alert('Tenés que escribir o elegir una sección.'); return false; }
      if(!nombre){ alert('Tenés que escribir un nombre de ítem.'); return false; }
      if(!l.itemsPresupuesto) l.itemsPresupuesto=[];
      l.itemsPresupuesto.push({id:DB.nid++, seccion:seccion, nombre:nombre});
      save();
      renderLineasProducto();
      abrirConfigPresupuesto(lineaId);
      return false; // ya manejamos la transición de vuelta a Configuración de presupuesto
    }
  );
}
function editarItemPresupuesto(lineaId, itemId){
  var l=DB.lineasProducto.find(function(x){return x.id===lineaId;});
  var it=l.itemsPresupuesto.find(function(x){return x.id===itemId;});
  var seccionesExistentes=[];
  (l.itemsPresupuesto||[]).forEach(function(x){ if(seccionesExistentes.indexOf(x.seccion)===-1) seccionesExistentes.push(x.seccion); });
  var datalistHTML='<datalist id="ip-secciones-dl">'+seccionesExistentes.map(function(s){return '<option value="'+s+'">';}).join('')+'</datalist>';

  openModal('✏️ Editar ítem de presupuesto',
    '<div class="fg2">'+
      '<div class="fg full"><label>Sección</label>'+
        '<input id="ip-seccion" type="text" list="ip-secciones-dl" value="'+it.seccion+'" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
        datalistHTML+
        (seccionesExistentes.length?'<div style="font-size:11px;color:var(--text2);margin-top:4px">Ya existen: '+seccionesExistentes.join(', ')+'</div>':'')+
      '</div>'+
      '<div class="fg full"><label>Nombre del ítem</label>'+
        '<input id="ip-nombre" type="text" value="'+it.nombre+'" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%"></div>'+
    '</div>',
    function(){
      var seccion=document.getElementById('ip-seccion').value.trim();
      var nombre=document.getElementById('ip-nombre').value.trim();
      if(!seccion){ alert('Tenés que escribir o elegir una sección.'); return false; }
      if(!nombre){ alert('Tenés que escribir un nombre de ítem.'); return false; }
      it.seccion=seccion; it.nombre=nombre;
      save();
      renderLineasProducto();
      abrirConfigPresupuesto(lineaId);
      return false;
    }
  );
}
function borrarItemPresupuesto(lineaId, itemId){
  if(!confirm('¿Eliminar este ítem?')) return;
  var l=DB.lineasProducto.find(function(x){return x.id===lineaId;});
  l.itemsPresupuesto=l.itemsPresupuesto.filter(function(x){return x.id!==itemId;});
  save();
  abrirConfigPresupuesto(lineaId);
  renderLineasProducto();
}

function editarDescripcionLinea(lineaId){
  var l=DB.lineasProducto.find(function(x){return x.id===lineaId;});
  openModal('Descripción del producto',
    '<div class="fg2">'+
      '<div class="fg full"><label>Descripción</label>'+
        '<textarea id="ld-desc" rows="4" placeholder="Qué es, para qué sirve, características del producto..." style="width:100%;padding:8px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;resize:vertical;font-family:inherit;box-sizing:border-box">'+(l.descripcion||'')+'</textarea></div>'+
    '</div>',
    function(){
      l.descripcion=document.getElementById('ld-desc').value.trim();
      save(); renderLineasProducto(); return true;
    }
  );
}
function borrarLineaProducto(id){
  var enUso=(DB.fabricacion||[]).some(function(f){return f.lineaId===id;});
  if(!confirm(enUso?'Hay órdenes de trabajo usando esta línea. ¿Eliminarla igual?':'¿Eliminar esta línea de producto?')) return;
  DB.lineasProducto=DB.lineasProducto.filter(function(l){return l.id!==id;});
  save(); renderLineasProducto();
}
function toggleLineaProducto(id){ _lineasAbiertas[id]=!_lineasAbiertas[id]; renderLineasProducto(); }
function toggleChecklistLinea(id){
  var l=DB.lineasProducto.find(function(x){return x.id===id;});
  l.checklistObligatorio=!l.checklistObligatorio;
  save(); renderLineasProducto();
}
function agregarFaseLinea(lineaId){
  var nombre=prompt('Nombre de la nueva fase:');
  if(!nombre) return;
  var l=DB.lineasProducto.find(function(x){return x.id===lineaId;});
  l.fases.push({id:'f'+(DB.nid++), nombre:nombre, ops:[]});
  _lineasAbiertas[lineaId]=true;
  save(); renderLineasProducto();
}
function editarFaseLinea(lineaId, faseId){
  var l=DB.lineasProducto.find(function(x){return x.id===lineaId;});
  var f=l.fases.find(function(x){return x.id===faseId;});
  var nombre=prompt('Editar nombre de la fase:', f.nombre);
  if(!nombre) return;
  f.nombre=nombre;
  save(); renderLineasProducto();
}
function borrarFaseLinea(lineaId, faseId){
  if(!confirm('¿Eliminar esta fase y todas sus tareas?')) return;
  var l=DB.lineasProducto.find(function(x){return x.id===lineaId;});
  l.fases=l.fases.filter(function(x){return x.id!==faseId;});
  save(); renderLineasProducto();
}
function moverFaseLinea(lineaId, faseId, dir){
  var l=DB.lineasProducto.find(function(x){return x.id===lineaId;});
  var idx=l.fases.findIndex(function(x){return x.id===faseId;});
  var nuevo=idx+dir;
  if(nuevo<0||nuevo>=l.fases.length) return;
  var tmp=l.fases[idx]; l.fases[idx]=l.fases[nuevo]; l.fases[nuevo]=tmp;
  save(); renderLineasProducto();
}
function agregarTareaLinea(lineaId, faseId){
  var desc=prompt('Descripción de la tarea:');
  if(!desc) return;
  var l=DB.lineasProducto.find(function(x){return x.id===lineaId;});
  var f=l.fases.find(function(x){return x.id===faseId;});
  f.ops.push(desc);
  save(); renderLineasProducto();
}
function editarTareaLinea(lineaId, faseId, opIdx){
  var l=DB.lineasProducto.find(function(x){return x.id===lineaId;});
  var f=l.fases.find(function(x){return x.id===faseId;});
  var desc=prompt('Editar descripción de la tarea:', f.ops[opIdx]);
  if(!desc) return;
  f.ops[opIdx]=desc;
  save(); renderLineasProducto();
}
function borrarTareaLinea(lineaId, faseId, opIdx){
  if(!confirm('¿Eliminar esta tarea?')) return;
  var l=DB.lineasProducto.find(function(x){return x.id===lineaId;});
  var f=l.fases.find(function(x){return x.id===faseId;});
  f.ops.splice(opIdx,1);
  save(); renderLineasProducto();
}
function moverTareaLinea(lineaId, faseId, opIdx, dir){
  var l=DB.lineasProducto.find(function(x){return x.id===lineaId;});
  var f=l.fases.find(function(x){return x.id===faseId;});
  var nuevo=opIdx+dir;
  if(nuevo<0||nuevo>=f.ops.length) return;
  var tmp=f.ops[opIdx]; f.ops[opIdx]=f.ops[nuevo]; f.ops[nuevo]=tmp;
  save(); renderLineasProducto();
}
function agregarKitItemLinea(lineaId){
  var compSel=[...DB.componentes].sort(function(a,b){var sa=(a.desc||'').toLowerCase();var sb=(b.desc||'').toLowerCase();return sa.localeCompare(sb,'es');}).map(function(c){
    return '<option value="'+c.id+'">'+c.codigo+' — '+c.desc+'</option>';
  }).join('');
  if(!DB.componentes.length){ alert('Primero cargá componentes en el Catálogo de Logística.'); return; }
  openModal('Agregar ítem al kit',
    '<div class="fg2">'+
      '<div class="fg full"><label>Componente</label>'+
        '<select id="kl-comp" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
          '<option value="">-- seleccionar componente --</option>'+compSel+
        '</select></div>'+
      '<div class="fg"><label>Cantidad</label><input id="kl-cant" type="number" min="1" value="1"></div>'+
    '</div>',
    function(){
      var compId=parseInt(document.getElementById('kl-comp').value)||0;
      var cant=parseFloat(document.getElementById('kl-cant').value)||0;
      if(!compId||!cant){alert('Seleccioná un componente e ingresá la cantidad.');return false;}
      var comp=DB.componentes.find(function(c){return c.id===compId;})||{};
      var l=DB.lineasProducto.find(function(x){return x.id===lineaId;});
      l.kit.push({id:DB.nid++, compId:compId, compCodigo:comp.codigo||'', compNombre:comp.desc||'', cant:cant});
      save(); renderLineasProducto(); return true;
    }
  );
}
function quitarKitItemLinea(lineaId, kitItemId){
  if(!confirm('¿Quitar este ítem del kit?')) return;
  var l=DB.lineasProducto.find(function(x){return x.id===lineaId;});
  l.kit=l.kit.filter(function(k){return k.id!==kitItemId;});
  save(); renderLineasProducto();
}




// =======================================================
// INSTALACIONES
// =======================================================

function getNumPI(){
  var yr = new Date().getFullYear();
  var existing = (DB.instalaciones||[]).filter(function(p){
    return p.numero && p.numero.startsWith('PI-'+yr);
  });
  var max=0;
  existing.forEach(function(p){
    var n=parseInt((p.numero||'').split('-')[2]||'0');
    if(n>max) max=n;
  });
  return 'PI-'+yr+'-'+String(max+1).padStart(4,'0');
}

function renderInstalaciones(){
  if(!DB.instalaciones) DB.instalaciones=[];
  var q=(document.getElementById('q-inst')?document.getElementById('q-inst').value||'':'').toLowerCase();
  var fest=document.getElementById('inst-estado-filter')?document.getElementById('inst-estado-filter').value:'';

  var lista=DB.instalaciones.filter(function(p){
    return (!q||((p.numero||'')+(p.cliente||'')+(p.nserie||'')).toLowerCase().includes(q))&&
           (!fest||p.estado===fest);
  }).sort(function(a,b){return (b.fecha||'').localeCompare(a.fecha||'');});

  var pendiente=(DB.instalaciones||[]).filter(function(p){return p.estado==='Pendiente';}).length;
  var enCurso=(DB.instalaciones||[]).filter(function(p){return p.estado==='En curso';}).length;
  var completado=(DB.instalaciones||[]).filter(function(p){return p.estado==='Completado';}).length;

  var el=document.getElementById('inst-stats');
  if(el) el.innerHTML=
    '<div class="stat"><div class="stat-n amber">'+pendiente+'</div><div class="stat-l">Pendientes</div></div>'+
    '<div class="stat"><div class="stat-n blue">'+enCurso+'</div><div class="stat-l">En curso</div></div>'+
    '<div class="stat"><div class="stat-n green">'+completado+'</div><div class="stat-l">Completados</div></div>'+
    '<div class="stat"><div class="stat-n">'+DB.instalaciones.length+'</div><div class="stat-l">Total</div></div>';

  var tb=document.getElementById('tbody-inst');
  if(!lista.length){tb.innerHTML='<tr><td colspan="8" class="empty">Sin pedidos de instalación.</td></tr>';return;}

  tb.innerHTML=lista.map(function(p){
    var estadoColor=p.estado==='Pendiente'?'p-a':p.estado==='En curso'?'p-b':p.estado==='Completado'?'p-g':'p-r';
    return '<tr>'+
      '<td style="font-family:monospace;font-size:11px;font-weight:700">'+p.numero+'</td>'+
      '<td style="font-family:monospace;font-size:11px">'+p.nserie+'</td>'+
      '<td style="font-size:11px"><strong>'+(p.cliente||'Stock')+'</strong>'+
        (p.direccion?'<br><span style="font-size:10px;color:var(--text2)">'+p.direccion+'</span>':'')+
      '</td>'+
      '<td>'+mPill(p.modelo)+'</td>'+
      '<td style="font-size:11px">'+(p.tecnico||'—')+'</td>'+
      '<td style="font-size:11px">'+(p.fechaTentativa||'—')+'</td>'+
      '<td><span class="pill '+estadoColor+'">'+p.estado+'</span></td>'+
      '<td><button class="btn btn-sm btn-p" onclick="abrirPI('+p.id+')">📋 Ver</button></td>'+
    '</tr>';
  }).join('');
}

function abrirPI(id){
  var p=DB.instalaciones.find(function(x){return x.id===id;});
  if(!p) return;

  var estadoColor=p.estado==='Pendiente'?'p-a':p.estado==='En curso'?'p-b':p.estado==='Completado'?'p-g':'p-r';

  // Kit table
  var kitHTML='<div class="card" style="margin-bottom:10px">'+
    '<div class="ch"><div class="ct">🧰 Materiales de instalación</div>'+
      '<button class="btn btn-sm" onclick="agregarMatInst('+id+')">➕ Agregar</button>'+
    '</div>'+
    '<div class="card-body">'+
    '<table style="width:100%;border-collapse:collapse">'+
    '<thead><tr style="background:var(--surface2)">'+
      '<th style="padding:5px 10px;font-size:10px">Código</th>'+
      '<th style="padding:5px 10px;font-size:10px">Material</th>'+
      '<th style="padding:5px 10px;font-size:10px;text-align:center">Cant.</th>'+
      '<th style="padding:5px 10px;font-size:10px">Origen</th>'+
      '<th style="padding:5px 10px;font-size:10px;text-align:center">Stock</th>'+
      '<th style="padding:5px 10px;font-size:10px"></th>'+
    '</tr></thead><tbody>'+
    (p.kit||[]).map(function(item,i){
      var stock=item.compId?stockActual(item.compId):'—';
      var stockColor=typeof stock==='number'?(stock<item.cant?'var(--red)':stock<item.cant*2?'var(--amber)':'var(--green)'):'var(--text2)';
      return '<tr style="border-bottom:1px solid var(--border)">'+
        '<td style="padding:5px 10px;font-family:monospace;font-size:11px">'+(item.compCodigo||'—')+'</td>'+
        '<td style="padding:5px 10px;font-size:11px">'+item.compNombre+'</td>'+
        '<td style="padding:5px 10px;text-align:center">'+item.cant+'</td>'+
        '<td style="padding:5px 10px;font-size:10px;color:var(--text2)">'+(item.origen==='zigbee'?'Sensor cliente':item.origen==='kit-base'?'Kit base':'Manual')+'</td>'+
        '<td style="padding:5px 10px;text-align:center;font-weight:700;color:'+stockColor+'">'+(typeof stock==='number'?stock:'—')+'</td>'+
        '<td style="padding:5px 10px"><button class="btn btn-sm" style="color:var(--red)" onclick="quitarMatInst('+id+','+i+')">🗑️</button></td>'+
      '</tr>';
    }).join('')+
    '</tbody></table></div></div>';

  var body=
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">'+
      '<span style="font-family:monospace;font-weight:700;color:var(--brand)">'+p.numero+'</span>'+
      '<span style="font-family:monospace;font-size:11px">'+p.nserie+'</span>'+
      mPill(p.modelo)+
      '<span class="pill '+estadoColor+'">'+p.estado+'</span>'+
    '</div>'+
    '<div class="fg2" style="margin-bottom:12px">'+
      '<div class="fg"><label>Cliente</label><div style="font-size:12px;padding:6px 0">'+(p.cliente||'Stock')+'</div></div>'+
      '<div class="fg"><label>Dirección</label><div style="font-size:12px;padding:6px 0">'+(p.direccion||'—')+'</div></div>'+
      '<div class="fg"><label>Teléfono</label><div style="font-size:12px;padding:6px 0">'+(p.tel||'—')+'</div></div>'+
      '<div class="fg"><label>Técnico</label><input id="pi-tecnico" value="'+(p.tecnico||'')+'" placeholder="Técnico asignado" onblur="savePI('+id+')"></div>'+
      '<div class="fg"><label>Fecha tentativa</label><input id="pi-fecha" type="date" value="'+(p.fechaTentativa||'')+'" onchange="savePI('+id+')"></div>'+
      '<div class="fg"><label>Estado</label>'+
        '<select id="pi-estado" onchange="cambiarEstadoPI('+id+')" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
          ['Pendiente','En curso','Completado','Cancelado'].map(function(s){
            return '<option'+(s===p.estado?' selected':'')+'>'+s+'</option>';
          }).join('')+
        '</select></div>'+
      '<div class="fg full"><label>Observaciones</label><input id="pi-obs" value="'+(p.obs||'')+'" placeholder="Observaciones..." onblur="savePI('+id+')"></div>'+
    '</div>'+
    kitHTML+
    (p.estado==='Pendiente'?
      '<div style="text-align:center;margin-top:8px">'+
        '<button class="btn btn-p" onclick="confirmarSalidaStockInst('+id+')">📦 Confirmar salida de stock</button>'+
      '</div>':'');

  openModal('Pedido de instalación — '+p.numero, body, null, true);
}

function savePI(id){
  var p=DB.instalaciones.find(function(x){return x.id===id;});
  if(!p) return;
  var g=function(elId){var el=document.getElementById(elId);return el?el.value:'';};
  p.tecnico=g('pi-tecnico');
  p.fechaTentativa=g('pi-fecha');
  p.obs=g('pi-obs');
  save();
}

function cambiarEstadoPI(id){
  var p=DB.instalaciones.find(function(x){return x.id===id;});
  if(!p) return;
  var nuevo=document.getElementById('pi-estado').value;
  p.estado=nuevo;
  // Update cliente estado
  if(p.clienteId){
    var c=DB.clientes.find(function(x){return x.id===p.clienteId;});
    if(c){
      if(nuevo==='En curso') c.estadoInstalacion='En curso';
      if(nuevo==='Completado'){
        c.estadoInstalacion='Completada';
        // Auto-import: add OTA entry and tecnico note
        var piObj=DB.instalaciones.find(function(x){return x.id===id;});
        if(piObj){
          if(!c.ota) c.ota=[];
          c.ota.push({fecha:today(),version:c.version||'—',tipo:'Instalación inicial',tecnico:piObj.tecnico||'',obs:'Instalación completada. Pedido '+piObj.numero});
          if(piObj.tecnico&&!c.notas) c.notas='Técnico instalador: '+piObj.tecnico;
        }
        // Ask if there are materials to return
        if(piObj){
          var matPend=(piObj.kit||[]).filter(function(m){return m.compId&&m.cant>(m.devuelto||0);});
          if(matPend.length&&confirm('\u00bfHay materiales para devolver al stock?')){
            var warnMsg='Materiales pendientes:\n\n';
            matPend.forEach(function(m){warnMsg+='\u2022 '+m.compNombre+': '+(m.cant-(m.devuelto||0))+'\n';});
            if(confirm(warnMsg+'\n\u00bfDevolver todos al stock ahora?')){
              matPend.forEach(function(m){
                DB.movimientos.push({id:DB.nid++,compId:m.compId,fecha:today(),tipo:'Entrada',motivo:'Devoluci\u00f3n instalaci\u00f3n '+piObj.numero,ref:piObj.nserie,cant:m.cant-(m.devuelto||0),precio:0});
                m.devuelto=m.cant;
              });
              save();
            }
          }
        }
      }
      if(nuevo==='Pendiente') c.estadoInstalacion='Pendiente';
    }
  }
  save();
  renderInstalaciones();
  cerrarModal();
}

function confirmarSalidaStockInst(id){
  var p=DB.instalaciones.find(function(x){return x.id===id;});
  if(!p) return;

  var faltantes=[];
  (p.kit||[]).forEach(function(item){
    if(!item.compId) return;
    var disponible=stockActual(item.compId);
    if(disponible<item.cant){
      faltantes.push({nombre:item.compNombre,necesita:item.cant,tiene:disponible});
    }
  });

  if(faltantes.length){
    var msg='⚠️ Stock insuficiente:\n\n';
    faltantes.forEach(function(f){msg+='• '+f.nombre+': necesita '+f.necesita+', hay '+f.tiene+'\n';});
    msg+='\n¿Confirmar salida de todas formas?';
    if(!confirm(msg)) return;
  }

  if(!confirm('¿Confirmar salida de stock para instalación '+p.numero+'?')) return;

  (p.kit||[]).forEach(function(item){
    if(!item.compId) return;
    var comp=DB.componentes.find(function(c){return c.id===item.compId;})||{};
    DB.movimientos.push({
      id:DB.nid++, compId:item.compId, fecha:today(),
      tipo:'Salida', motivo:'Instalación — '+p.numero+' — '+p.cliente,
      ref:p.nserie, cant:item.cant,
      precio:parseFloat(comp.costo||comp.precio)||0
    });
  });

  p.estado='En curso';
  if(p.clienteId){
    var c=DB.clientes.find(function(x){return x.id===p.clienteId;});
    if(c) c.estadoInstalacion='En curso';
  }
  save();
  cerrarModal();
  renderInstalaciones();
  alert('Salida de stock confirmada. Pedido en curso.');
}

function agregarMatInst(piId){
  var p=DB.instalaciones.find(function(x){return x.id===piId;});
  if(!p) return;
  var compSel=[...DB.componentes].sort(function(a,b){var sa=(a.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();var sb=(b.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();return sa.localeCompare(sb,'es');}).map(function(c){
    return '<option value="'+c.id+'">'+c.codigo+' — '+c.desc+'</option>';
  }).join('');

  openModal('Agregar material a instalación',
    '<div class="fg2">'+
      '<div class="fg full"><label>Componente</label>'+
        '<select id="mi-comp" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
          '<option value="">-- seleccionar --</option>'+compSel+
        '</select></div>'+
      '<div class="fg"><label>Cantidad</label><input id="mi-cant" type="number" min="1" value="1"></div>'+
    '</div>',
    function(){
      var compId=parseInt(document.getElementById('mi-comp').value)||0;
      var cant=parseFloat(document.getElementById('mi-cant').value)||0;
      if(!compId||!cant){alert('Seleccioná componente y cantidad.');return false;}
      var comp=DB.componentes.find(function(c){return c.id===compId;})||{};
      if(!p.kit) p.kit=[];
      p.kit.push({compId:compId,compCodigo:comp.codigo||'',compNombre:comp.desc||'',cant:cant,unidad:comp.unidad||'',origen:'manual',devuelto:0});
      save(); cerrarModal(); abrirPI(piId); return true;
    }
  );
}

function quitarMatInst(piId, idx){
  var p=DB.instalaciones.find(function(x){return x.id===piId;});
  if(!p||!p.kit) return;
  if(!confirm('¿Quitar este material del kit?')) return;
  p.kit.splice(idx,1);
  save(); cerrarModal(); abrirPI(piId);
}

// KIT BASE INSTALACION =====================================
function renderKitInst(){
  if(!DB.kitinst) DB.kitinst=[];
  var ver=document.getElementById('kitinst-version');
  if(ver) ver.textContent='Versión '+(DB.kitinstVersion||1)+' · '+(DB.kitinstFecha||today());

  var tb=document.getElementById('tbody-kitinst');
  if(!DB.kitinst.length){tb.innerHTML='<tr><td colspan="6" class="empty">Sin materiales en el kit base.</td></tr>';return;}

  tb.innerHTML=DB.kitinst.map(function(item,i){
    var comp=DB.componentes.find(function(c){return c.id===item.compId;})||{};
    var stock=stockActual(item.compId);
    var color=stock<item.cant?'var(--red)':stock<item.cant*2?'var(--amber)':'var(--green)';
    return '<tr>'+
      '<td style="font-family:monospace;font-size:11px">'+(comp.codigo||'—')+'</td>'+
      '<td>'+(comp.desc||item.compNombre||'—')+'</td>'+
      '<td style="text-align:center;font-weight:700">'+item.cant+'</td>'+
      '<td>'+(comp.unidad||'—')+'</td>'+
      '<td style="text-align:center;font-weight:700;color:'+color+'">'+stock+'</td>'+
      '<td style="display:flex;gap:3px">'+
        '<button class="btn btn-sm" onclick="modalKitInstItem('+i+')">✏️</button>'+
        '<button class="btn btn-sm" style="color:var(--red)" onclick="eliminarKitInstItem('+i+')">🗑️</button>'+
      '</td>'+
    '</tr>';
  }).join('');
}

function modalKitInstEditar(){
  // Filter components with area Instalacion
  var compsInst = DB.componentes.filter(function(c){
    return c.area === 'Instalacion';
  }).sort(function(a,b){var sa=(a.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();var sb=(b.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();return sa.localeCompare(sb,'es');});

  if(!compsInst.length){
    alert('No hay componentes con área "Instalacion" en el catálogo.');
    return;
  }

  // Build kit map for quick lookup
  var kitMap = {};
  (DB.kitinst||[]).forEach(function(item){
    kitMap[item.compId] = item.cant;
  });

  // Build table with all Instalacion components
  var rows = compsInst.map(function(c){
    var cant = kitMap[c.id]||0;
    var stock = stockActual(c.id);
    var stockColor = stock<=0?'var(--red)':stock<cant?'var(--amber)':'var(--green)';
    return '<tr style="border-bottom:1px solid var(--border)">'+
      '<td style="padding:5px 10px;font-family:monospace;font-size:11px">'+c.codigo+'</td>'+
      '<td style="padding:5px 10px;font-size:12px">'+c.desc+'</td>'+
      '<td style="padding:5px 10px;font-size:11px;color:var(--text2)">'+c.unidad+'</td>'+
      '<td style="padding:5px 10px;font-weight:700;color:'+stockColor+'">'+stock+'</td>'+
      '<td style="padding:5px 10px">'+
        '<input type="number" min="0" value="'+cant+'" data-compid="'+c.id+'" '+
        'style="width:70px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;text-align:center">'+
      '</td>'+
    '</tr>';
  }).join('');

  var body =
    '<div style="font-size:11px;color:var(--text2);margin-bottom:10px">'+
      'Ingresá la cantidad de cada componente. Poné <strong>0</strong> para excluirlo del kit.'+
    '</div>'+
    '<div style="max-height:400px;overflow-y:auto">'+
    '<table style="width:100%;border-collapse:collapse">'+
    '<thead><tr style="background:var(--surface2);position:sticky;top:0">'+
      '<th style="padding:6px 10px;font-size:10px;text-align:left">Código</th>'+
      '<th style="padding:6px 10px;font-size:10px;text-align:left">Descripción</th>'+
      '<th style="padding:6px 10px;font-size:10px;text-align:left">Unidad</th>'+
      '<th style="padding:6px 10px;font-size:10px;text-align:center">Stock</th>'+
      '<th style="padding:6px 10px;font-size:10px;text-align:center">Cantidad en kit</th>'+
    '</tr></thead>'+
    '<tbody>'+rows+'</tbody></table></div>';

  openModal('Editar kit base de instalación', body, function(){
    var inputs = document.querySelectorAll('#mbox input[data-compid]');
    var newKit = [];
    inputs.forEach(function(input){
      var compId = parseInt(input.dataset.compid);
      var cant = parseFloat(input.value)||0;
      if(cant > 0){
        var comp = DB.componentes.find(function(c){return c.id===compId;})||{};
        newKit.push({
          compId: compId,
          compCodigo: comp.codigo||'',
          compNombre: comp.desc||'',
          cant: cant
        });
      }
    });
    DB.kitinst = newKit;
    DB.kitinstVersion = (parseInt(DB.kitinstVersion||0)+1);
    DB.kitinstFecha = today();
    save();
    renderKitInst();
    return true;
  });
}

function modalKitInstItem(idx){
  // Keep for edit individual items from table
  var item=idx>=0?(DB.kitinst[idx]||{}):null;
  var compsInst=[...DB.componentes].filter(function(c){return c.area==='Instalacion';}).sort(function(a,b){var sa=(a.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();var sb=(b.desc||'').replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]+/,'').toLowerCase();return sa.localeCompare(sb,'es');});
  var compSel=compsInst.map(function(c){
    return '<option value="'+c.id+'"'+(item&&item.compId===c.id?' selected':'')+'>'+c.codigo+' — '+c.desc+'</option>';
  }).join('');

  openModal(idx>=0?'Editar material del kit':'Agregar material al kit',
    '<div class="fg2">'+
      '<div class="fg full"><label>Componente (área Instalación)</label>'+
        '<select id="ki-comp" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
          '<option value="">-- seleccionar --</option>'+compSel+
        '</select></div>'+
      '<div class="fg"><label>Cantidad</label>'+
        '<input id="ki-cant" type="number" min="1" value="'+(item?item.cant:1)+'"></div>'+
    '</div>',
    function(){
      var compId=parseInt(document.getElementById('ki-comp').value)||0;
      var cant=parseFloat(document.getElementById('ki-cant').value)||0;
      if(!compId||!cant){alert('Seleccioná un componente e ingresá la cantidad.');return false;}
      var comp=DB.componentes.find(function(c){return c.id===compId;})||{};
      var newItem={compId:compId,compCodigo:comp.codigo||'',compNombre:comp.desc||'',cant:cant};
      if(idx>=0){DB.kitinst[idx]=newItem;}else{DB.kitinst.push(newItem);}
      DB.kitinstVersion=(parseInt(DB.kitinstVersion||0)+1);
      DB.kitinstFecha=today();
      save(); renderKitInst(); return true;
    }
  );
}


function eliminarKitInstItem(idx){
  if(!confirm('¿Eliminar este material del kit base?')) return;
  DB.kitinst.splice(idx,1);
  DB.kitinstVersion=(parseInt(DB.kitinstVersion||0)+1);
  DB.kitinstFecha=today();
  save(); renderKitInst();
}



function toggleNav(el){
  var items = el.nextElementSibling;
  if(!items||!items.classList.contains('nav-section-items')) return;
  var isOpen = items.classList.contains('open');
  if(isOpen){
    items.classList.remove('open');
    el.innerHTML = el.innerHTML.replace('▾','▸');
  } else {
    items.classList.add('open');
    el.innerHTML = el.innerHTML.replace('▸','▾');
  }
}

function initNavCollapse(){
  // All sections closed by default via CSS - nothing needed
  // Arrows already show ▸ in HTML
}





function verClienteActa(id){
  verCliente(id);
  setTimeout(function(){ goSub('acta'); }, 300);
}

function renderActas(){
  var q=(document.getElementById('q-actas')?document.getElementById('q-actas').value||'':'').toLowerCase();
  var clientes=DB.clientes.filter(function(c){
    return c.estado==='Activo' && (!q||(c.nombre+c.lote+(c.barrio||'')).toLowerCase().includes(q));
  }).sort(function(a,b){return (a.nombre||'').localeCompare(b.nombre||'');});

  var tb=document.getElementById('tbody-actas');
  if(!clientes.length){tb.innerHTML='<tr><td colspan="7" class="empty">Sin clientes activos.</td></tr>';return;}

  tb.innerHTML=clientes.map(function(c){
    var numActa='ACR-'+new Date().getFullYear()+'-'+String(c.id).padStart(4,'0');
    var firmada=c.actaFechaFirma?'<span class="pill p-g">Firmada</span>':'<span class="pill p-a">Pendiente</span>';
    return '<tr>'+
      '<td style="font-family:monospace;font-size:11px">'+numActa+'</td>'+
      '<td><strong>'+c.nombre+'</strong><br><span style="font-size:10px;color:var(--text2)">'+(c.lote||'')+(c.barrio?' · '+c.barrio:'')+'</span></td>'+
      '<td>'+mPill(c.modelo)+'</td>'+
      '<td style="font-size:11px">'+(c.fecha||'—')+'</td>'+
      '<td style="font-size:11px">'+(c.actaFechaFirma||'—')+'</td>'+
      '<td>'+firmada+'</td>'+
      '<td style="display:flex;gap:4px">'+
        '<button class="btn btn-sm btn-p" onclick="generarPDFActa('+c.id+')">📄 PDF</button>'+
        '<button class="btn btn-sm" onclick="verClienteActa('+c.id+')" title="Ver en ficha">Ver</button>'+
      '</td>'+
    '</tr>';
  }).join('');
}


function getNumMant(){
  var yr = new Date().getFullYear();
  var all = [];
  (DB.clientes||[]).forEach(function(c){
    (c.mant||[]).forEach(function(m){
      if(m.numero) all.push(m.numero);
    });
  });
  var max = 0;
  all.forEach(function(n){
    if(n.startsWith('MNT-'+yr)){
      var num = parseInt(n.split('-')[2]||'0');
      if(num>max) max=num;
    }
  });
  return 'MNT-'+yr+'-'+String(max+1).padStart(4,'0');
}

function exportarMant(clienteId, mantIdx){
  var c = DB.clientes.find(function(x){return x.id===clienteId;});
  if(!c) return;
  var m = c.mant[mantIdx];
  if(!m) return;

  // Include catalog for material selection on mobile
  // Enrich registro with client data
  var registroCompleto = JSON.parse(JSON.stringify(m));
  registroCompleto.cliente = c.nombre;
  registroCompleto.modelo = c.modelo||'';
  if(!registroCompleto.nserie) registroCompleto.nserie = c.mac||'';
  if(!registroCompleto.garantiaVence) registroCompleto.garantiaVence = c.actaGarantiaVence||'';

  var export_data = {
    tipo: 'riego_mantenimiento',
    version: '1.0',
    registro: registroCompleto,
    clienteId: clienteId,
    mantIdx: mantIdx,
    catalogo: (DB.componentes||[]).map(function(comp){
      return {id:comp.id, codigo:comp.codigo, desc:comp.desc, unidad:comp.unidad, costo:comp.costo};
    })
  };

  var json = JSON.stringify(export_data, null, 2);
  var blob = new Blob([json], {type:'application/json'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'mant_'+m.numero+'_'+c.nombre.replace(/[^a-zA-Z0-9]/g,'_')+'.json';
  a.click();
  URL.revokeObjectURL(url);
  vssSubirPendienteMantDrive(export_data);
}

function procesarMantenimientoImportado(data){
  if(data.tipo!=='riego_mantenimiento') return null;
  var reg = data.registro;
  if(!reg.clienteId&&data.clienteId) reg.clienteId=parseInt(data.clienteId)||data.clienteId;
  var c = DB.clientes.find(function(x){return x.id===parseInt(reg.clienteId)||x.id===reg.clienteId;});
  if(!c&&reg.cliente) c=DB.clientes.find(function(x){return x.nombre===reg.cliente;});
  if(c){ reg.clienteNombre=c.nombre; reg.clienteId=c.id; reg.modelo=reg.modelo||c.modelo||''; }
  if(!DB.mantenimientos) DB.mantenimientos=[];
  var existing=DB.mantenimientos.findIndex(function(m){return m.numero===reg.numero;});
  var actualizado = existing>=0;
  if(actualizado) DB.mantenimientos[existing]=reg;
  else DB.mantenimientos.unshift(reg);
  save();
  return {numero:reg.numero, cliente:reg.clienteNombre||'cliente desconocido', actualizado:actualizado};
}
function importarMant(input){
  var file = input.files[0];
  if(!file) return;
  var reader = new FileReader();
  reader.onload = function(e){
    try{
      var data = JSON.parse(e.target.result);
      var r = procesarMantenimientoImportado(data);
      if(!r){ alert('Archivo inválido. No es un registro de mantenimiento válido.'); return; }
      alert('Registro '+r.numero+' '+(r.actualizado?'actualizado':'importado')+' — '+r.cliente);
    } catch(err){
      alert('Error al leer el archivo: '+err.message);
    }
  };
  reader.readAsText(file);
}
function vssSyncMantenimientoDrive(){
  vssDriveGetToken(function(token){
    vssDriveEnsureFolderNamed(token, 'RiegoAdaptativoMantenimiento', function(folderId){
      vssDriveBuscarArchivo(token, folderId, 'completado.json', function(f){
        if(!f){ alert('No hay ningún mantenimiento completado en Drive todavía.'); return; }
        vssDriveBajarJSON(token, f.id, function(data){
          if(!data){ alert('Error al descargar el archivo de Drive.'); return; }
          var r = procesarMantenimientoImportado(data);
          if(!r){ alert('El archivo en Drive no es un registro de mantenimiento válido.'); return; }
          alert('✔ Registro '+r.numero+' '+(r.actualizado?'actualizado':'importado')+' desde Drive — '+r.cliente);
        });
      });
    });
  });
}
// Sube el registro "pendiente" (el que se le asigna a un técnico) a Drive,
// para que la app móvil de mantenimiento lo pueda traer sin transferencia manual.
function vssSubirPendienteMantDrive(export_data){
  vssDriveGetToken(function(token){
    vssDriveEnsureFolderNamed(token, 'RiegoAdaptativoMantenimiento', function(folderId){
      vssDriveSubirArchivo(token, folderId, 'pendiente.json', export_data, function(){
        // silencioso: no interrumpe el flujo de exportarMant/exportarMantNew
      });
    });
  });
}


// =======================================================
// MANTENIMIENTOS — módulo independiente
// =======================================================

function getNumMantNew(){
  var yr = new Date().getFullYear();
  var max = 0;
  (DB.mantenimientos||[]).forEach(function(m){
    if(m.numero&&m.numero.startsWith('MNT-'+yr)){
      var n = parseInt((m.numero||'').split('-')[2]||'0');
      if(n>max) max=n;
    }
  });
  return 'MNT-'+yr+'-'+String(max+1).padStart(4,'0');
}


function formatMatFacturar(matFacturar){
  if(!matFacturar) return '—';
  // Handle both old string format and new array format
  if(typeof matFacturar === 'string') return matFacturar||'—';
  if(!Array.isArray(matFacturar)||!matFacturar.length) return '—';
  var total = matFacturar.reduce(function(a,m){return a+(parseFloat(m.subtotal)||0);},0);
  return matFacturar.map(function(m){
    return m.desc+' x'+m.cant+(m.costo?' ($'+Math.round(m.subtotal||0).toLocaleString('es-AR')+')':'');
  }).join(', ')+' — Total: $'+Math.round(total).toLocaleString('es-AR');
}

function renderMantenimientos(){
  if(!DB.mantenimientos) DB.mantenimientos=[];
  var q=(document.getElementById('q-mnt')?document.getElementById('q-mnt').value||'':'').toLowerCase();
  var ftipo=document.getElementById('mnt-tipo-filter')?document.getElementById('mnt-tipo-filter').value:'';
  var ffact=document.getElementById('mnt-fact-filter')?document.getElementById('mnt-fact-filter').value:'';

  var lista=DB.mantenimientos.filter(function(m){
    var matchQ=!q||((m.numero||'')+(m.clienteNombre||'')+(m.tipo||'')+(m.motivo||'')).toLowerCase().includes(q);
    var matchT=!ftipo||m.tipo===ftipo;
    var aFact=(parseFloat(m.costo)||0)>0||(m.matFacturar&&m.matFacturar.trim());
    var matchF=!ffact||(ffact==='si'&&aFact&&m.garantia!=='Sí')||(ffact==='no'&&(!aFact||m.garantia==='Sí'));
    return matchQ&&matchT&&matchF;
  }).sort(function(a,b){return (b.fecha||'').localeCompare(a.fecha||'');});

  var total=DB.mantenimientos.length;
  var aFact=DB.mantenimientos.filter(function(m){return ((parseFloat(m.costo)||0)>0||(m.matFacturar&&m.matFacturar.trim()))&&m.garantia!=='Sí';}).length;
  var gar=DB.mantenimientos.filter(function(m){return m.garantia==='Sí';}).length;
  var moTotal=DB.mantenimientos.reduce(function(a,m){return a+(parseFloat(m.costo)||0);},0);

  var el=document.getElementById('mnt-stats-panel');
  if(el) el.innerHTML=
    '<div class="stat"><div class="stat-n">'+total+'</div><div class="stat-l">Registros</div></div>'+
    '<div class="stat"><div class="stat-n amber">'+aFact+'</div><div class="stat-l">A facturar</div></div>'+
    '<div class="stat"><div class="stat-n green">'+gar+'</div><div class="stat-l">En garantía</div></div>'+
    '<div class="stat"><div class="stat-n blue">$'+Math.round(moTotal).toLocaleString('es-AR')+'</div><div class="stat-l">MO total</div></div>';

  var tb=document.getElementById('tbody-mnt');
  if(!lista.length){tb.innerHTML='<tr><td colspan="9" class="empty">Sin registros de mantenimiento.</td></tr>';return;}

  tb.innerHTML=lista.map(function(m){
    var matFact=m.matFacturar;
    var tieneMatFact=Array.isArray(matFact)?matFact.length>0:(matFact&&matFact.trim());
    var aFact=(parseFloat(m.costo)||0)>0||tieneMatFact;
    var factBadge=m.garantia==='Sí'?'<span class="pill p-g">Garantía</span>':
      tieneMatFact?'<span class="pill p-a" title="'+formatMatFacturar(matFact)+'">Sí</span>':'<span style="color:var(--text3);font-size:11px">—</span>';
    return '<tr>'+
      '<td style="font-family:monospace;font-size:10px">'+m.numero+'</td>'+
      '<td style="font-size:11px">'+m.fecha+'</td>'+
      '<td><strong>'+(m.clienteNombre||m.cliente||'—')+'</strong></td>'+
      '<td>'+tipMantPill(m.tipo)+'</td>'+
      '<td style="font-size:11px">'+(m.motivo||'—')+'</td>'+
      '<td>'+garPill(m.garantia)+'</td>'+
      '<td>'+factBadge+'</td>'+
      '<td style="font-size:11px;text-align:right">'+(function(){
        var mf=m.matFacturar;
        if(!mf||m.garantia==='Sí') return '—';
        if(Array.isArray(mf)&&mf.length) return '$'+Math.round(mf.reduce(function(a,x){return a+(parseFloat(x.subtotal)||0);},0)).toLocaleString('es-AR');
        return '—';
      })()+'</td>'+
      '<td style="font-size:11px;text-align:right">'+(m.costo&&parseFloat(m.costo)>0?'$'+Math.round(parseFloat(m.costo)).toLocaleString('es-AR'):'—')+'</td>'+
      '<td style="display:flex;gap:3px">'+
        '<button class="btn btn-sm btn-p" onclick="exportarMantNew(\''+m.numero+'\')" title="Exportar al móvil">📤</button>'+
        '<button class="btn btn-sm" onclick="modalEditarMant(\''+m.numero+'\')" title="Ver/Editar">✏️</button>'+
        '<button class="btn btn-sm" style="color:var(--red)" onclick="borrarMant(\''+m.numero+'\')" title="Eliminar">🗑️</button>'+
      '</td>'+
    '</tr>';
  }).join('');
}

function modalNuevoMant(){
  var clienteOpts=[...DB.clientes].sort(function(a,b){return (a.nombre||'').localeCompare(b.nombre||'');}).map(function(c){
    return '<option value="'+c.id+'">'+c.nombre+' — '+(c.lote||'')+(c.barrio?' · '+c.barrio:'')+'</option>';
  }).join('');
  var numNuevo=getNumMantNew();
  var tipoOpts=['Correctivo','Preventivo','Configuración','Actualización de firmware','Cambio de pilas','Garantía','Otro'];

  openModal('Nuevo registro de mantenimiento',
    '<div class="fg2">'+
      '<div class="fg"><label>N° Registro</label><div style="padding:6px 9px;font-family:monospace;font-weight:700;color:var(--brand)">'+numNuevo+'</div></div>'+
      '<div class="fg"><label>Fecha *</label><input id="mn-f" type="date" value="'+today()+'"></div>'+
      '<div class="fg"><label>Técnico</label><input id="mn-te" placeholder="Nombre del técnico"></div>'+
      '<div class="fg full"><label>Cliente *</label>'+
        '<select id="mn-cli" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%" onchange="onChangeMantCliente()">'+
          '<option value="">-- seleccionar cliente --</option>'+clienteOpts+
        '</select></div>'+
      '<div class="fg"><label>N° Serie sistema</label><input id="mn-ns" placeholder="AQ-2026-001"></div>'+
      '<div class="fg"><label>Tipo *</label>'+
        '<select id="mn-ti" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
          tipoOpts.map(function(t){return '<option>'+t+'</option>';}).join('')+
        '</select></div>'+
      '<div class="fg"><label>Garantía válida hasta</label><input id="mn-gv" type="date"></div>'+
      '<div class="fg full"><label>Motivo del llamado *</label><input id="mn-mo" placeholder="Ej: Válvula no cierra, sensor sin señal..."></div>'+
      '<div class="fg full"><label>Falla detectada</label><textarea id="mn-fa" rows="2" placeholder="Describir la falla..."></textarea></div>'+
      '<div class="fg full"><label>Reparación realizada</label><textarea id="mn-re" rows="2" placeholder="Describir lo realizado..."></textarea></div>'+
      '<div class="fg full"><label>Material a facturar</label><input id="mn-mf" placeholder="Material a facturar al cliente"></div>'+
      '<div class="fg"><label>En garantía</label>'+
        '<select id="mn-g" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
          '<option>No</option><option>Sí</option>'+
        '</select></div>'+
      '<div class="fg"><label>Mano de obra ($)</label><input id="mn-c" type="number" min="0" value="0"></div>'+
      '<div class="fg full"><label>Observaciones</label><textarea id="mn-o" rows="2" placeholder="Notas adicionales..."></textarea></div>'+
    '</div>',
    function(){
      var cliId=parseInt(document.getElementById('mn-cli').value)||0;
      var mo=document.getElementById('mn-mo').value.trim();
      if(!cliId){alert('Seleccioná un cliente.');return false;}
      if(!mo){alert('El motivo del llamado es obligatorio.');return false;}
      var c=DB.clientes.find(function(x){return x.id===cliId;})||{};
      var reg={
        numero:numNuevo,
        fecha:document.getElementById('mn-f').value,
        tecnico:document.getElementById('mn-te').value,
        clienteId:cliId,
        clienteNombre:c.nombre||'',
        modelo:c.modelo||'',
        nserie:document.getElementById('mn-ns').value,
        tipo:document.getElementById('mn-ti').value,
        garantiaVence:document.getElementById('mn-gv').value,
        motivo:mo,
        falla:document.getElementById('mn-fa').value,
        reparacion:document.getElementById('mn-re').value,
        materiales:[],
        matFacturar:document.getElementById('mn-mf').value,
        garantia:document.getElementById('mn-g').value,
        costo:document.getElementById('mn-c').value||'0',
        obs:document.getElementById('mn-o').value,
        estado:'Pendiente'
      };
      if(!DB.mantenimientos) DB.mantenimientos=[];
      DB.mantenimientos.unshift(reg);
      save(); renderMantenimientos(); return true;
    }
  );
}

function onChangeMantCliente(){
  var cliId=parseInt(document.getElementById('mn-cli').value)||0;
  if(!cliId) return;
  var c=DB.clientes.find(function(x){return x.id===cliId;});
  if(!c) return;
  var ns=document.getElementById('mn-ns');
  var gv=document.getElementById('mn-gv');
  if(ns&&!ns.value) ns.value=c.mac||'';
  if(gv&&!gv.value&&c.actaGarantiaVence) gv.value=c.actaGarantiaVence;
}

function modalEditarMant(numero){
  var m=DB.mantenimientos.find(function(x){return x.numero===numero;});
  if(!m) return;
  var tipoOpts=['Correctivo','Preventivo','Configuración','Actualización de firmware','Cambio de pilas','Garantía','Otro'];

  openModal('Registro '+m.numero+' — '+(m.clienteNombre||''),
    '<div class="fg2">'+
      '<div class="fg"><label>Cliente</label><div style="padding:6px 9px;font-size:12px;font-weight:700">'+(m.clienteNombre||'—')+'</div></div>'+
      '<div class="fg"><label>Fecha</label><input id="me-f" type="date" value="'+(m.fecha||today())+'"></div>'+
      '<div class="fg"><label>Técnico</label><input id="me-te" value="'+(m.tecnico||'')+'" placeholder="Nombre del técnico"></div>'+
      '<div class="fg"><label>N° Serie sistema</label><input id="me-ns" value="'+(m.nserie||'')+'" placeholder="AQ-2026-001"></div>'+
      '<div class="fg"><label>Tipo</label>'+
        '<select id="me-ti" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
          tipoOpts.map(function(t){return '<option'+(t===m.tipo?' selected':'')+'>'+t+'</option>';}).join('')+
        '</select></div>'+
      '<div class="fg"><label>Garantía válida hasta</label><input id="me-gv" type="date" value="'+(m.garantiaVence||'')+'"></div>'+
      '<div class="fg full"><label>Motivo del llamado</label><input id="me-mo" value="'+(m.motivo||'')+'" placeholder="Motivo..."></div>'+
      '<div class="fg full"><label>Falla detectada</label><textarea id="me-fa" rows="2">'+(m.falla||'')+'</textarea></div>'+
      '<div class="fg full"><label>Reparación realizada</label><textarea id="me-re" rows="2">'+(m.reparacion||'')+'</textarea></div>'+
      '<div class="fg full"><label>Material a facturar</label><div style="padding:6px 9px;background:#fff8e1;border:1px solid #ffe082;border-radius:var(--r);font-size:12px;min-height:32px">'+(formatMatFacturar(m.matFacturar))+'</div></div>'+
      '<div class="fg"><label>En garantía</label>'+
        '<select id="me-g" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%">'+
          ['No','Sí'].map(function(s){return '<option'+(s===m.garantia?' selected':'')+'>'+s+'</option>';}).join('')+
        '</select></div>'+
      '<div class="fg"><label>Mano de obra ($)</label><input id="me-c" type="number" min="0" value="'+(m.costo||0)+'"></div>'+
      '<div class="fg full"><label>Observaciones</label><textarea id="me-o" rows="2">'+(m.obs||'')+'</textarea></div>'+
    '</div>',
    function(){
      m.fecha=document.getElementById('me-f').value;
      m.tecnico=document.getElementById('me-te').value;
      m.nserie=document.getElementById('me-ns').value;
      m.tipo=document.getElementById('me-ti').value;
      m.garantiaVence=document.getElementById('me-gv').value;
      m.motivo=document.getElementById('me-mo').value;
      m.falla=document.getElementById('me-fa').value;
      m.reparacion=document.getElementById('me-re').value;
      var mfEl=document.getElementById('me-mf'); m.matFacturar=mfEl?mfEl.value:m.matFacturar;
      m.garantia=document.getElementById('me-g').value;
      m.costo=document.getElementById('me-c').value||'0';
      m.obs=document.getElementById('me-o').value;
      save(); renderMantenimientos(); return true;
    }
  );
}

function borrarMant(numero){
  if(!confirm('¿Eliminar el registro '+numero+'? Esta acción no se puede deshacer.')) return;
  DB.mantenimientos=DB.mantenimientos.filter(function(m){return m.numero!==numero;});
  save(); renderMantenimientos();
}

function exportarMantNew(numero){
  var m=DB.mantenimientos.find(function(x){return x.numero===numero;});
  if(!m) return;
  // Enrich registro with all client fields for mobile display
  var registroExp = JSON.parse(JSON.stringify(m));
  registroExp.cliente = m.clienteNombre||'';
  var export_data={
    tipo:'riego_mantenimiento',
    version:'1.0',
    registro:registroExp,
    clienteId:m.clienteId,
    catalogo:(DB.componentes||[]).sort(function(a,b){return (a.desc||'').localeCompare(b.desc||'');}).map(function(c){
      return {id:c.id,codigo:c.codigo,desc:c.desc,unidad:c.unidad,costo:c.costo};
    })
  };
  var json=JSON.stringify(export_data,null,2);
  var blob=new Blob([json],{type:'application/json'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url;
  a.download='mant_'+m.numero+'_'+(m.clienteNombre||'').replace(/[^a-zA-Z0-9]/g,'_')+'.json';
  a.click();
  URL.revokeObjectURL(url);
  vssSubirPendienteMantDrive(export_data);
}


// INIT
// =======================================================
// Almacenamiento persistente: evita que el navegador evicte IndexedDB
// (y con eso el handle de la carpeta local) por presión de espacio o inactividad.
if(navigator.storage && navigator.storage.persist){ navigator.storage.persist().catch(function(){}); }
goTo('clientes');
setTimeout(initNavCollapse, 50);

// Snapshot local al cerrar con la X (beforeunload — síncrono, siempre funciona)
window.addEventListener('beforeunload', function(){ vssHacerSnapshot(false); });
// Snapshot al ocultar la pestaña o minimizar + intento de sync a Drive si hay cambios pendientes
document.addEventListener('visibilitychange', function(){
  if(document.visibilityState === 'hidden'){
    vssHacerSnapshot(false);
    if(!vssGToken) vssGTokenCargarLocal();
    if(vssGToken && _vssSyncPendiente) vssSyncSilencioso();
  }
});
// Reconecta la carpeta local vinculada (si hay una) sin pedir permiso — solo consulta
vssRestaurarCarpeta();
// Reconecta Drive en silencio si ya había una sesión válida (sin popup)
if(vssGTokenCargarLocal()) vssSyncSetBadge('ok'); else vssSyncSetBadge('noauth');
// PRESUPUESTOS helpers =====================================
function getLineaPres(p){ return p.lineaId?DB.lineasProducto.find(function(l){return l.id===p.lineaId;}):null; }
// Pill que muestra la línea de producto de un presupuesto (reemplaza el viejo mPill(p.modelo))
function presLineaPill(p){
  var l=getLineaPres(p);
  return '<span class="pill p-x">'+(l?l.nombre:'— sin línea —')+'</span>';
}

function defPrecios(linea){
  const items={};
  (linea&&linea.itemsPresupuesto||[]).forEach(function(it){ items[it.nombre]={cant:0,precio:0}; });
  return items;
}

function defPres(){
  return {
    validez:15, plazo:'5 dias habiles',
    formaPago:'50% adelanto - 50% contra entrega',
    garantia:'12 meses en materiales y mano de obra',
    incluye:'Instalacion, configuracion y puesta en marcha',
    noIncluye:'Obras civiles, cableado de red electrica',
    moneda:'ARS', tipoCambio:1, descuento:0, margen:30, obsInternas:''
  };
}

function getCorrelativo(){
  const yr = String(new Date().getFullYear());
  const same = DB.presupuestos.filter(function(p){ return (p.fecha||today()).slice(0,4)===yr; });
  return same.length + 1;
}

function presNum(p){
  const yr = (p.fecha||today()).slice(0,4);
  const num = String(p.correlativo||1).padStart(4,'0');
  const ver = p.version > 1 ? '-v'+p.version : '';
  return 'VSS-'+yr+'-'+num+ver;
}

function formatMonto(v,moneda){
  return ((moneda==='USD')?'U$S ':'$')+Math.round(v).toLocaleString('es-AR');
}

// Genérico: suma el subtotal de cada ítem de precios agrupado por la "sección" que
// definió la línea de producto en su Configuración de presupuesto.
function calcSubtotales(p){
  const cat={};
  const linea=getLineaPres(p);
  const items=(linea&&linea.itemsPresupuesto)||[];
  if(!p.precios) return cat;
  items.forEach(function(it){
    var i=p.precios[it.nombre];
    if(!i) return;
    var val=(parseFloat(i.cant)||0)*(parseFloat(i.precio)||0);
    cat[it.seccion]=(cat[it.seccion]||0)+val;
  });
  return cat;
}

function calcTotal(p){
  const sub=calcSubtotales(p);
  const bruto=Object.values(sub).reduce(function(a,v){return a+v;},0);
  const margen=bruto*(parseFloat(p.margen)||0)/100;
  return bruto+margen-(parseFloat(p.descuento)||0);
}

var _saveTimer=null;

function trackEstadoPres(id, nuevoEstado){
  var p = DB.presupuestos.find(function(x){return x.id===id;});
  if(!p) return;
  var prev = p.estado;
  if(!p.historial) p.historial = [];
  p.historial.push({fecha:today(), de:prev, a:nuevoEstado});
  // Store specific state dates
  if(nuevoEstado==='Enviado') p.fechaEnviado = today();
  if(nuevoEstado==='Aprobado') p.fechaAprobado = today();
  if(nuevoEstado==='Rechazado') p.fechaRechazado = today();
  updPres(id, 'estado', nuevoEstado);
}

function updPres(id,campo,valor){
  const p=DB.presupuestos.find(function(x){return x.id===id;});
  if(!p) return;
  p[campo]=valor;
  // Debounce save - wait 800ms after last change
  if(_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(function(){ save(); _saveTimer=null; }, 800);
  if(campo==='margen'||campo==='descuento') actualizarResumenPres(id);
}

function updatePrecio(id,key,field,valor,inputEl){
  const p=DB.presupuestos.find(function(x){return x.id===id;});
  if(!p||!p.precios) return;
  if(!p.precios[key]) p.precios[key]={cant:0,precio:0};
  p.precios[key][field]=parseFloat(valor)||0;
  if(_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(function(){ save(); _saveTimer=null; }, 800);

  // Recalcular en vivo: subtotal de esta fila puntual
  if(inputEl){
    var row=inputEl.closest('tr');
    var subCell=row&&row.querySelector('td:last-child');
    if(subCell){
      var i=p.precios[key];
      var sub=(parseFloat(i.cant)||0)*(parseFloat(i.precio)||0);
      subCell.textContent=formatMonto(sub,p.moneda);
    }
  }
  actualizarResumenPres(id);
}

// Recalcula y pinta en vivo los subtotales por sección y el total final del editor de presupuesto abierto
function actualizarResumenPres(id){
  const p=DB.presupuestos.find(function(x){return x.id===id;});
  if(!p) return;
  var linea=getLineaPres(p);
  var items=(linea&&linea.itemsPresupuesto)||[];
  var secciones=[];
  items.forEach(function(it){ if(secciones.indexOf(it.seccion)===-1) secciones.push(it.seccion); });
  var sub=calcSubtotales(p);
  secciones.forEach(function(s,si){
    var el=document.getElementById('pres-sec-'+si);
    if(el) el.textContent=formatMonto(sub[s]||0,p.moneda);
  });
  var bruto=Object.values(sub).reduce(function(a,v){return a+v;},0);
  var margenVal=bruto*(parseFloat(p.margen)||0)/100;
  var totalFinal=bruto+margenVal-(parseFloat(p.descuento)||0);
  var totalEl=document.getElementById('pres-total-final');
  if(totalEl) totalEl.textContent=formatMonto(totalFinal,p.moneda);
}

function nuevaVersionPres(id){
  const orig=DB.presupuestos.find(function(x){return x.id===id;});
  if(!orig) return;
  if(!confirm('Crear nueva version de '+presNum(orig)+'?')) return;
  const nueva=JSON.parse(JSON.stringify(orig));
  nueva.id=DB.nid++;
  nueva.version=(orig.version||1)+1;
  nueva.estado='Borrador';
  nueva.fecha=today();
  DB.presupuestos.unshift(nueva);
  save(); renderPresupuestos();
}

function abrirEditorPres(id){
  const p=DB.presupuestos.find(function(x){return x.id===id;});
  if(!p) return;
  if(!p.precios) p.precios={};
  var linea=getLineaPres(p);
  var items=(linea&&linea.itemsPresupuesto)||[];
  var clienteYaActivado=p.clienteId&&DB.clientes.find(function(c){return c.id===p.clienteId;});

  function fila(nombre, idx){
    var i=p.precios[nombre]||{cant:0,precio:0};
    var sub=(parseFloat(i.cant)||0)*(parseFloat(i.precio)||0);
    var h="<tr style='border-bottom:1px solid var(--border)'>";
    h+="<td style='padding:6px 10px;font-size:12px'>"+nombre+"</td>";
    h+="<td style='padding:4px 6px'><input type='number' min='0' value='"+(i.cant||0)+"'";
    h+=" style='width:60px;text-align:center;border:1px solid var(--border);padding:4px 6px;font-size:12px'";
    h+=" data-pid='"+id+"' data-key='"+nombre+"' data-field='cant'";
    h+=" onfocus='this.select()'";
    h+=" oninput='updatePrecio(parseInt(this.dataset.pid),this.dataset.key,this.dataset.field,this.value,this)'></td>";
    h+="<td style='padding:4px 6px'><input type='number' min='0' value='"+(i.precio||0)+"'";
    h+=" style='width:110px;border:1px solid var(--border);padding:4px 8px;font-size:12px'";
    h+=" data-pid='"+id+"' data-key='"+nombre+"' data-field='precio'";
    h+=" onfocus='this.select()'";
    h+=" oninput='updatePrecio(parseInt(this.dataset.pid),this.dataset.key,this.dataset.field,this.value,this)'></td>";
    h+="<td id='pres-sub-"+idx+"' style='padding:6px 10px;font-size:12px;font-weight:600;text-align:right'>"+formatMonto(sub,p.moneda)+"</td>";
    h+="</tr>";
    return h;
  }

  function sec(titulo,filas){
    return '<tr style="background:#0D1B24"><td colspan="4" style="padding:7px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#fff">'+titulo+'</td></tr>'+filas;
  }

  const sub=calcSubtotales(p);
  const bruto=Object.values(sub).reduce(function(a,v){return a+v;},0);
  const margenVal=bruto*(parseFloat(p.margen)||0)/100;
  const totalFinal=bruto+margenVal-(parseFloat(p.descuento)||0);

  var inp=function(label,campo,val,type){
    type=type||'text';
    var h="<div class='fg' style='margin:0'><label>"+label+"</label>";
    h+="<input type='"+type+"' value='"+(val||"")+"'";
    h+=" style='padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%'";
    h+=" data-pid='"+id+"' data-campo='"+campo+"'";
    h+=(type==='number'?" onfocus='this.select()'":"");
    h+=" oninput='updPres(parseInt(this.dataset.pid),this.dataset.campo,this.value)'></div>";
    return h;
  };

  var sel=function(label,campo,opts,cur){
    var h="<div class='fg' style='margin:0'><label>"+label+"</label>";
    h+="<select style='padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%'";
    h+=" data-pid='"+id+"' data-campo='"+campo+"'";
    h+=" onchange='updPres(parseInt(this.dataset.pid),this.dataset.campo,this.value)'>";
    h+=opts.map(function(o){return '<option'+(o===cur?' selected':'')+'>'+o+'</option>';}).join('');
    h+="</select></div>";
    return h;
  };

  // Selector de línea de producto — dispara un re-render completo del modal al cambiar
  var lineaSelectHTML='<div class="fg" style="margin:0"><label>Línea de producto</label>'+
    '<select style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%" onchange="cambiarLineaPres('+id+',this.value)">'+
      '<option value="">-- elegir --</option>'+
      DB.lineasProducto.map(function(l){return '<option value="'+l.id+'"'+(p.lineaId===l.id?' selected':'')+'>'+l.nombre+'</option>';}).join('')+
    '</select></div>';

  var secciones=[];
  items.forEach(function(it){ if(secciones.indexOf(it.seccion)===-1) secciones.push(it.seccion); });

  var tablaPrecios, resumen;
  if(!linea){
    tablaPrecios='<p style="padding:16px;text-align:center;color:var(--text2);font-size:12.5px;background:var(--surface2);border-radius:var(--r);margin-bottom:12px">Elegí una línea de producto arriba para cargar la tabla de precios.</p>';
    resumen='';
  } else if(!items.length){
    tablaPrecios='<p style="padding:16px;text-align:center;color:var(--text2);font-size:12.5px;background:var(--surface2);border-radius:var(--r);margin-bottom:12px">Esta línea todavía no tiene ítems de presupuesto configurados. Andá a <b>Líneas de producto → ⚙️ Presupuesto</b> para cargarlos.</p>';
    resumen='';
  } else {
    var filaIdx=0;
    tablaPrecios=
      '<table style="width:100%;border-collapse:collapse;margin-bottom:12px">'+
      '<thead><tr style="background:var(--surface2)">'+
        '<th style="padding:7px 10px;text-align:left;font-size:10px">Item</th>'+
        '<th style="padding:7px 10px;font-size:10px;text-align:center">Cant.</th>'+
        '<th style="padding:7px 10px;font-size:10px">Precio unit.</th>'+
        '<th style="padding:7px 10px;font-size:10px;text-align:right">Subtotal</th>'+
      '</tr></thead><tbody>'+
      secciones.map(function(s){
        return sec(s, items.filter(function(it){return it.seccion===s;}).map(function(it){return fila(it.nombre, filaIdx++);}).join(''));
      }).join('')+
      '</tbody></table>';

    resumen=
      '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);padding:12px;margin-bottom:12px">'+
        '<div id="pres-resumen-secciones" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px;font-size:12px;color:var(--text2)">'+
          secciones.map(function(s,si){return '<div>'+s+': <strong id="pres-sec-'+si+'">'+formatMonto(sub[s]||0,p.moneda)+'</strong></div>';}).join('')+
        '</div>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;align-items:end">'+
          '<div class="fg" style="margin:0"><label>Margen (%)</label>'+
            '<input type="number" min="0" max="100" value="'+(p.margen||0)+'" '+
            'style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%" '+
            "onfocus=\"this.select()\" oninput=\"updPres("+id+",'margen',this.value)\"></div>"+
          '<div class="fg" style="margin:0"><label>Descuento ($)</label>'+
            '<input type="number" min="0" value="'+(p.descuento||0)+'" '+
            'style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%" '+
            "onfocus=\"this.select()\" oninput=\"updPres("+id+",'descuento',this.value)\"></div>"+
          '<div style="background:#0D1B24;color:#fff;border-radius:var(--r);padding:10px;text-align:center">'+
            '<div style="font-size:9px;color:#aaa;text-transform:uppercase;margin-bottom:3px">Total final</div>'+
            '<div id="pres-total-final" style="font-size:17px;font-weight:700">'+formatMonto(totalFinal,p.moneda)+'</div>'+
          '</div>'+
        '</div>'+
      '</div>';
  }

  openModal('Presupuesto '+presNum(p),
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">'+
      '<div class="fg" style="margin:0"><label>Estado</label>'+
      '<select style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%"'+
      ' data-pid="'+id+'" data-campo="estado"'+
      ' onchange="trackEstadoPres('+id+',this.value)">'+
      ['Borrador','Enviado','Aprobado','Rechazado'].map(function(o){return '<option'+(o===p.estado?' selected':'')+'>'+o+'</option>';}).join('')+
      '</select></div>'+
      sel('Moneda','moneda',['ARS','USD'],p.moneda)+
      inp('Tipo de cambio','tipoCambio',p.tipoCambio,'number')+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">'+
      '<div class="fg full" style="margin:0;grid-column:1/-1"><label>Cliente existente (opcional)</label>'+
        '<div style="display:flex;gap:8px;align-items:flex-start">'+
        '<select style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;flex:1" onchange="cargarClienteEnPresupuesto('+id+',this.value)">'+
          '<option value="">-- nuevo / escribir a mano --</option>'+
          DB.clientes.slice().sort(function(a,b){return a.nombre.localeCompare(b.nombre,'es');}).map(function(c){return '<option value="'+c.id+'"'+(p.clientePotencialId===c.id?' selected':'')+'>'+c.nombre+(c.barrio?' — '+c.barrio:'')+(c.estado==='Potencial'?' (potencial)':'')+'</option>';}).join('')+
        '</select>'+
        '<button type="button" class="btn btn-sm" onclick="nuevoClientePotencial('+id+')" style="white-space:nowrap">➕ Cliente potencial</button>'+
        '</div>'+
        '<div style="font-size:11px;color:var(--text2);margin-top:4px">Elegir uno completa nombre, teléfono, email, dirección y barrio abajo — se pueden seguir editando después. "Cliente potencial" crea uno nuevo con estado Potencial, sin datos de instalación.</div>'+
      '</div>'+
      inp('Nombre cliente *','nombre',p.nombre)+
      inp('Telefono','tel',p.tel)+
      inp('Email','email',p.email,'email')+
      inp('Direccion','dir',p.dir)+
      inp('Barrio','barrio',p.barrio)+
      lineaSelectHTML+
      inp('Tecnico','tecnico',p.tecnico)+
    '</div>'+
    '<hr class="div"><div class="sectitle">Computo de materiales y precios</div>'+
    tablaPrecios+resumen+
    '<hr class="div"><div class="sectitle">Condiciones comerciales</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">'+
      inp('Validez (dias)','validez',p.validez,'number')+
      inp('Plazo de entrega','plazo',p.plazo)+
      inp('Forma de pago','formaPago',p.formaPago)+
      inp('Garantia','garantia',p.garantia)+
      inp('Incluye','incluye',p.incluye)+
      inp('No incluye','noIncluye',p.noIncluye)+
    '</div>'+
    '<hr class="div">'+
    '<div class="fg"><label>Observaciones internas (no aparecen en el PDF)</label>'+
      "<textarea style='padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%;min-height:56px;font-family:inherit'" +"oninput='updPres("+id+",\"obsInternas\",this.value)'>"+(p.obsInternas||'')+"</textarea></div>"+
    '<div style="display:flex;gap:8px;margin-top:8px">'+
      '<button class="btn btn-p" style="flex:1" onclick="generarPDF('+id+');cerrarModal()">PDF</button>'+
      '<button class="btn" style="flex:1;color:var(--blue);border-color:var(--blue)" onclick="enviarEmailPres('+id+');cerrarModal()">Email</button>'+
      (p.estado==='Aprobado'&&!clienteYaActivado?'<button class="btn btn-g" style="flex:1" onclick="convertirCliente('+id+');cerrarModal()">Cliente Activo</button>':'')+
      (clienteYaActivado?'<span style="flex:1;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--green)">✔ Cliente: '+clienteYaActivado.nombre+'</span>':'')+
    '</div>'
  , function(){
    // Force save before closing
    if(!p.nombre.trim()){ alert('Ingresá el nombre del cliente antes de guardar.'); return false; }
    if(_saveTimer){ clearTimeout(_saveTimer); _saveTimer=null; }
    save();
    _presDraftId=null; // se guardó explícitamente con el botón, ya no es un borrador a limpiar
    renderPresupuestos();
    return true;
  });
}
function cambiarLineaPres(id, lineaId){
  var p=DB.presupuestos.find(function(x){return x.id===id;});
  if(!p) return;
  p.lineaId=lineaId?parseInt(lineaId):null;
  if(!p.precios) p.precios={};
  var linea=getLineaPres(p);
  (linea&&linea.itemsPresupuesto||[]).forEach(function(it){
    if(!p.precios[it.nombre]) p.precios[it.nombre]={cant:0,precio:0};
  });
  save();
  abrirEditorPres(id);
}

// Autocompleta los datos de contacto del presupuesto a partir de un cliente ya cargado en el sistema.
// No vincula p.clienteId (ese campo se reserva para "convertirCliente", que crea un cliente NUEVO
// a partir del presupuesto) — esto es solo una carga rápida de datos, se puede seguir editando después.
function cargarClienteEnPresupuesto(id, clienteId){
  var p=DB.presupuestos.find(function(x){return x.id===id;});
  if(!p) return;
  if(!clienteId) return; // "-- nuevo / escribir a mano --"
  var c=DB.clientes.find(function(x){return x.id===parseInt(clienteId);});
  if(!c) return;
  p.nombre=c.nombre||'';
  p.tel=c.tel||'';
  p.email=c.email||'';
  p.dir=c.lote||'';
  p.barrio=c.barrio||'';
  p.clientePotencialId = (c.estado==='Potencial') ? c.id : null;
  save();
  abrirEditorPres(id);
}

// Crea un cliente potencial desde el propio formulario de presupuesto: datos básicos
// nada más (sin modelo, MAC, PIN, etc. — eso queda para cuando se apruebe y pase a Activo).
function nuevoClientePotencial(presupuestoId){
  openModal('➕ Cliente potencial',
    '<div class="fg2">'+
      '<div class="fg full"><label>Nombre *</label><input id="cp-nombre" type="text" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%"></div>'+
      '<div class="fg"><label>Teléfono</label><input id="cp-tel" type="text" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%"></div>'+
      '<div class="fg"><label>Email</label><input id="cp-email" type="email" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%"></div>'+
      '<div class="fg"><label>Dirección / Lote</label><input id="cp-dir" type="text" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%"></div>'+
      '<div class="fg"><label>Barrio</label><input id="cp-barrio" type="text" style="padding:6px 9px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;width:100%"></div>'+
    '</div>'+
    '<div style="font-size:11px;color:var(--text2);margin-top:6px">Queda guardado como <b>Potencial</b> — solo sirve para este presupuesto o para lista de correo, hasta que se apruebe y pase a Activo.</div>',
    function(){
      var nombre=document.getElementById('cp-nombre').value.trim();
      if(!nombre){ alert('El nombre es obligatorio.'); return false; }
      var nuevo={
        id:DB.nid++, nombre:nombre,
        tel:document.getElementById('cp-tel').value.trim(),
        email:document.getElementById('cp-email').value.trim(),
        lote:document.getElementById('cp-dir').value.trim(),
        barrio:document.getElementById('cp-barrio').value.trim(),
        modelo:'', version:'', fecha:'', mac:'', pin:'', chatid:'', ambientes:'',
        dir:'', estado:'Potencial', estadoInstalacion:'', presId:presupuestoId,
        equipo:{esp_serie:'',proveedor:'',fcompra:'',ups_marca:'',ups_modelo:'',ups_tension:'',ups_garantia:'No',ups_gar_vence:'',ups_ultimo_service:'',sirena_marca:'',sirena_modelo:'',sirena_serie:''},
        zigbee:[], ota:[], mant:[]
      };
      DB.clientes.unshift(nuevo);
      var p=DB.presupuestos.find(function(x){return x.id===presupuestoId;});
      if(p){
        p.nombre=nuevo.nombre; p.tel=nuevo.tel; p.email=nuevo.email;
        p.dir=nuevo.lote; p.barrio=nuevo.barrio;
        p.clientePotencialId=nuevo.id;
      }
      save();
      abrirEditorPres(presupuestoId);
      return false; // ya manejamos la vuelta al editor de presupuesto nosotros mismos
    }
  );
}

function nuevoPresupuesto(){
  const p = Object.assign({
    id:DB.nid++, relId:null,
    correlativo:getCorrelativo(), version:1,
    nombre:'', tel:'', email:'', dir:'', barrio:'', ambientes:'',
    tipo:'Casa', sup:'', plantas:'Planta baja', material:'Mampostería',
    alarma:'No', perro:'No', horario:'Siempre habitado',
    lineaId:null, modelo:'', sensores:{}, router:'', distancia:'', obstaculos:'',
    tecnico:'', obs:'', estado:'Borrador', fecha:today(),
    precios:{}
  }, defPres());
  DB.presupuestos.unshift(p);
  save();
  _presDraftId=p.id;
  abrirEditorPres(p.id);
}


