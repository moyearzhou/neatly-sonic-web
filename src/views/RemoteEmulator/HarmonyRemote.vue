<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import axios from '@/http/axios';
import H264Decoder from './H264Decoder';
import RenderDeviceName from '@/components/RenderDeviceName.vue';
import { Cellphone, InfoFilled, Refresh, Camera, House, Back, SwitchButton, Connection, Close, FullScreen } from '@element-plus/icons';
const { t } = useI18n();
const route = useRoute(), router = useRouter();
const activeTab = ref('main'), screenshots = ref([]), ticker = ref(0), idleCount = ref(0);
const leftWidth = ref(Math.max(22, Math.min(33, 420 / window.innerWidth * 100))), horizontal = ref(false), screenRatio = ref(1084 / 2412);
const splitStyle = computed(() => ({ '--device-width': `${leftWidth.value}%`, '--screen-ratio': screenRatio.value }));
const elapsed = computed(() => `${String(Math.floor(ticker.value / 3600)).padStart(2, '0')}:${String(Math.floor(ticker.value / 60) % 60).padStart(2, '0')}:${String(ticker.value % 60).padStart(2, '0')}`);
const panels = computed(() => [
  { name: 'main', label: t('androidRemoteTS.code.remoteControlPanel') },
  { name: 'apps', label: t('androidRemoteTS.code.app') },
  { name: 'proxy', label: t('androidRemoteTS.code.packet') },
  { name: 'screenshots', label: t('androidRemoteTS.code.screenshotQuick') },
  { name: 'terminal', label: 'Terminal' },
  { name: 'automation', label: t('harmonyRemote.automation') },
  { name: 'elements', label: t('routes.controlElement') },
  { name: 'web', label: t('harmonyRemote.webDebug') },
  { name: 'performance', label: t('IOSRemote.perfmon') },
]);
function leave() { disconnect(); router.push('/Index/Devices'); }
function screenshot() {
  if (!ready.value || !canvas.value || screenshots.value.length >= 20) return;
  const image = canvas.value.toDataURL('image/png');
  screenshots.value.unshift({ image, name: `Harmony-${Date.now()}.png` }); activeTab.value = 'screenshots';
}
function fullscreen() { canvas.value?.requestFullscreen?.(); }
let splitPointer;
function startSplit(event) { splitPointer = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); }
function moveSplit(event) { if (event.pointerId === splitPointer) leftWidth.value = Math.min(65, Math.max(22, event.clientX / window.innerWidth * 100)); }
function endSplit() { splitPointer = null; }

const canvas = ref(null), device = ref({}), ready = ref(false), message = ref(''), text = ref('');
const fps = ref(0), latency = ref(0);
let socket, decoder, display, pointer, sequence = 0, disposed = false, frames = 0;
let lastMove = 0, pendingMove, lastPoint, moveTimer, statsTimer, connectTimer;
let connecting = false;
function status(key) { message.value = t(`harmonyRemote.${key}`); }
function send(action) {
  if (!ready.value || socket?.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > 65536) { ready.value = false; status('slow'); disconnect(); return; }
  idleCount.value = 0;
  socket.send(JSON.stringify({ ...action, id: ++sequence }));
}
function point(event) {
  if (!display || !canvas.value) return null;
  const rect = canvas.value.getBoundingClientRect();
  const border = canvas.value.clientLeft;
  let width = rect.width - 2 * border, height = rect.height - 2 * border;
  let left = rect.left + border, top = rect.top + border;
  // Fullscreen can letterbox the canvas; touch only the actual visible frame.
  if (document.fullscreenElement === canvas.value) {
    const ratio = canvas.value.width / canvas.value.height;
    if (width / height > ratio) { const visible = height * ratio; left += (width - visible) / 2; width = visible; }
    else { const visible = width / ratio; top += (height - visible) / 2; height = visible; }
    if (event.clientX < left || event.clientX > left + width || event.clientY < top || event.clientY > top + height) return null;
  }
  // The canvas has the decoded frame's aspect ratio, without object-fit letterboxing.
  return {
    x: Math.max(0, Math.min(display.width - 1, Math.floor((event.clientX - left) / width * display.width))),
    y: Math.max(0, Math.min(display.height - 1, Math.floor((event.clientY - top) / height * display.height))),
  };
}
function down(event) {
  if (!ready.value || pointer != null || event.button !== 0) return;
  const p = point(event); if (!p) return;
  event.preventDefault(); pointer = event.pointerId; lastPoint = p;
  canvas.value.setPointerCapture(pointer); send({ type: 'touchDown', ...p });
}
function flushMove() {
  clearTimeout(moveTimer); moveTimer = null;
  if (pendingMove) { send({ type: 'touchMove', ...pendingMove }); pendingMove = null; lastMove = performance.now(); }
}
function move(event) {
  if (event.pointerId !== pointer) return;
  pendingMove = point(event); lastPoint = pendingMove;
  // Coalesce only moves. Down/up remain ordered and immediate.
  if (performance.now() - lastMove >= 16) flushMove();
  else if (!moveTimer) moveTimer = setTimeout(flushMove, 16);
}
function up(event) {
  if (event.pointerId !== pointer) return;
  flushMove(); const p = point(event) || lastPoint; if (p) send({ type: 'touchUp', ...p });
  pointer = null;
}
function cancelPointer() {
  if (pointer == null) return;
  flushMove(); send({ type: 'touchUp', ...lastPoint });
  pointer = null;
}
function disconnect() {
  cancelPointer(); ready.value = false; clearTimeout(connectTimer);
  if (socket) { socket.onclose = socket.onmessage = socket.onerror = null; socket.close(); socket = null; }
  decoder?.destroy(); decoder = null;
}
async function connect() {
  if (connecting) return;
  connecting = true;
  disconnect(); status('connecting');
  if (typeof VideoDecoder === 'undefined') { status('unsupported'); connecting = false; return; }
  try {
    const response = await axios.get('/controller/devices', { params: { id: route.params.deviceId } });
    if (disposed) return;
    if (response.code !== 2000 || response.data.platform !== 6 || response.data.status !== 'ONLINE') { status('busy'); return; }
    device.value = response.data;
    const result = await axios.get('/controller/agents', { params: { id: device.value.agentId } });
    if (disposed) return;
    if (result.code !== 2000) { status('failed'); return; }
    const agent = result.data;
    decoder = new H264Decoder(frame => {
      try {
        const c = canvas.value; if (!c || disposed) return;
        if (c.width !== frame.displayWidth || c.height !== frame.displayHeight) { c.width = frame.displayWidth; c.height = frame.displayHeight; screenRatio.value = frame.displayWidth / frame.displayHeight; }
        c.getContext('2d', { alpha: false }).drawImage(frame, 0, 0); frames++;
        // Rotation changes the input coordinate space. Reconnect to query it before accepting more input.
        if (display && Math.abs(frame.displayWidth / frame.displayHeight - display.width / display.height) > 0.05) {
          status('rotated'); disconnect();
        }
      } finally { frame.close(); }
    }, () => { status('decodeFailed'); disconnect(); });
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${protocol}://${agent.host}:${agent.port}/websockets/harmony/${encodeURIComponent(device.value.udId)}`);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', key: agent.secretKey, token: localStorage.getItem('SonicToken') }));
    socket.onmessage = event => {
      if (typeof event.data === 'string') {
        const value = JSON.parse(event.data);
        if (value.type === 'display') display = value;
        if (value.type === 'ready') { clearTimeout(connectTimer); ready.value = true; status('connected'); }
        if (value.type === 'error') { status('failed'); disconnect(); }
        if (value.type === 'ack') latency.value = value.ms;
        return;
      }
      if (event.data.byteLength < 10) return;
      const bytes = new Uint8Array(event.data), view = new DataView(event.data);
      decoder?.push(bytes.subarray(10), { config: !!bytes[0], keyFrame: !!bytes[1], timestamp: view.getFloat64(2) });
    };
    socket.onerror = () => { status('failed'); disconnect(); };
    socket.onclose = () => { status('disconnected'); disconnect(); };
    connectTimer = setTimeout(() => { status('failed'); disconnect(); }, 40000);
  } catch { status('failed'); disconnect(); } finally { connecting = false; }
}
onMounted(() => {
  connect(); window.addEventListener('blur', cancelPointer);
  statsTimer = setInterval(() => { fps.value = frames; frames = 0; if (ready.value) { ticker.value++; idleCount.value++; } }, 1000);
});
onBeforeUnmount(() => { disposed = true; disconnect(); clearInterval(statsTimer); window.removeEventListener('blur', cancelPointer); });
</script>

<template>
  <main class="harmony-workbench" :class="{ horizontal }" :style="splitStyle">
    <header class="workbench-header">
      <el-page-header @back="leave">
        <template #content>
          <div class="header-content">{{ t('routes.remoteControl') }} -
            <div class="session-time"><span>{{ t('common.inuse') }} {{ elapsed }}</span><span>{{ t('common.inidle') }} {{ idleCount }} {{ t('common.sec') }}</span></div>
            <el-tag size="small" effect="plain">HarmonyOS NEXT</el-tag>
          </div>
        </template>
      </el-page-header>
      <el-button size="small" :title="t('harmonyRemote.switchLayout')" @click="horizontal = !horizontal"><el-icon><FullScreen /></el-icon></el-button>
    </header>
    <div class="workbench-body">
      <section class="device-column">
        <el-card class="device-card" :body-style="{ padding: '10px', background: '#ccc', position: 'relative' }">
          <template #header>
            <div class="device-heading"><el-icon><Cellphone /></el-icon><RenderDeviceName :device="device" />
              <el-popover placement="bottom" width="300" trigger="hover"><div>HarmonyOS NEXT {{ device.version }}</div><p>{{ device.udId }}</p><div>{{ device.size }}</div>
                <template #reference><el-icon class="device-info"><InfoFilled /></el-icon></template>
              </el-popover>
            </div>
          </template>
          <div class="device-stage">
            <div class="phone-display">
              <canvas ref="canvas" width="542" height="1206" :aria-label="t('harmonyRemote.screen')"
                @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @contextmenu.prevent />
              <div class="phone-navigation">
                <el-button :disabled="!ready" :title="t('harmonyRemote.home')" @click="send({ type: 'key', key: 'Home' })"><el-icon><House /></el-icon></el-button>
                <el-button :disabled="!ready" :title="t('harmonyRemote.back')" @click="send({ type: 'key', key: 'Back' })"><el-icon><Back /></el-icon></el-button>
              </div>
            </div>
            <nav class="device-toolbar" :aria-label="t('harmonyRemote.tools')">
              <el-tooltip :content="t('harmonyRemote.reconnect')" placement="right"><el-button circle size="small" type="info" :disabled="ready" @click="connect"><el-icon><Refresh /></el-icon></el-button></el-tooltip>
              <el-tooltip :content="t('harmonyRemote.fullscreen')" placement="right"><el-button circle size="small" type="info" @click="fullscreen"><el-icon><FullScreen /></el-icon></el-button></el-tooltip>
              <el-tooltip :content="t('androidRemoteTS.code.screenshot')" placement="right"><el-button circle size="small" type="primary" :disabled="!ready || screenshots.length >= 20" @click="screenshot"><el-icon><Camera /></el-icon></el-button></el-tooltip>
              <el-tooltip :content="t('harmonyRemote.power')" placement="right"><el-button circle size="small" type="primary" :disabled="!ready" @click="send({ type: 'key', key: 'Power' })"><el-icon><SwitchButton /></el-icon></el-button></el-tooltip>
              <el-tooltip :content="t('harmonyRemote.release')" placement="right"><el-button circle size="small" type="info" :disabled="!ready" @click="disconnect(); status('disconnected')"><el-icon><Close /></el-icon></el-button></el-tooltip>
            </nav>
          </div>
          <div class="stream-status"><span :class="{ online: ready }">● {{ ready ? 'H.264' : t('harmonyRemote.disconnectedShort') }}</span><span>{{ fps }} FPS · {{ latency }} ms</span></div>
        </el-card>
      </section>
      <div class="splitter" role="separator" :aria-label="t('harmonyRemote.resize')" aria-orientation="vertical" @pointerdown="startSplit" @pointermove="moveSplit" @pointerup="endSplit" @pointercancel="endSplit"><span>⋮</span></div>
      <section class="operation-column">
        <el-tabs v-model="activeTab" class="remote-tab harmony-tabs" :tab-position="horizontal ? 'top' : 'left'">
          <el-tab-pane v-for="panel in panels" :key="panel.name" :name="panel.name" :label="panel.label">
            <template v-if="panel.name === 'main'">
              <el-alert :title="message" :type="ready ? 'success' : 'info'" :closable="false" show-icon />
              <div class="control-grid">
                <el-card><template #header><strong>{{ t('androidRemoteTS.code.inputText') }}</strong></template>
                  <el-input v-model="text" :disabled="!ready" type="textarea" :rows="6" maxlength="10000" :placeholder="t('harmonyRemote.textHint')" />
                  <div class="card-actions"><el-button size="small" @click="text = ''">{{ t('androidRemoteTS.code.clear') }}</el-button><el-button size="small" type="primary" :disabled="!ready || !text" @click="send({ type: 'text', text }); text = '';">{{ t('androidRemoteTS.code.send') }}</el-button></div>
                </el-card>
                <el-card><template #header><strong>{{ t('harmonyRemote.connection') }}</strong></template>
                  <p>HarmonyOS NEXT · {{ device.version }}</p><p>{{ device.udId }}</p><p>{{ t('harmonyRemote.inputAck') }} {{ latency }} ms</p>
                  <div class="card-actions"><el-button size="small" :disabled="ready" @click="connect">{{ t('harmonyRemote.reconnect') }}</el-button><el-button size="small" :disabled="!ready" @click="disconnect(); status('disconnected')">{{ t('harmonyRemote.release') }}</el-button></div>
                </el-card>
              </div>
              <el-card class="instructions"><template #header>{{ t('harmonyRemote.instructions') }}</template><p>{{ t('harmonyRemote.hint') }}</p></el-card>
            </template>
            <template v-else-if="panel.name === 'screenshots'">
              <div class="card-actions"><el-button type="primary" size="small" :disabled="!ready || screenshots.length >= 20" @click="screenshot">{{ t('androidRemoteTS.code.screenshot') }}</el-button><el-button size="small" @click="screenshots = []">{{ t('androidRemoteTS.code.clean') }}</el-button></div>
              <el-empty v-if="!screenshots.length" :description="t('androidRemoteTS.code.noScreenshots')" />
              <div v-else class="screenshot-grid"><el-card v-for="image in screenshots" :key="image.name"><img :src="image.image" :alt="image.name" /><a :href="image.image" :download="image.name">{{ t('androidRemoteTS.code.savePicture') }}</a></el-card></div>
            </template>
            <el-empty v-else :description="t('harmonyRemote.notConnected')"><el-tag type="info">{{ t('harmonyRemote.scope') }}</el-tag></el-empty>
          </el-tab-pane>
        </el-tabs>
      </section>
    </div>
  </main>
</template>
<style scoped>
.harmony-workbench { height:100vh; box-sizing:border-box; background:#fff; color:#606266; overflow:hidden; }
.workbench-header { height:56px; padding:0 20px; display:flex; justify-content:space-between; align-items:center; }
.header-content { display:flex; align-items:center; gap:12px; color:#909399; font-size:18px; }.session-time { display:flex; flex-direction:column; font-size:12px; line-height:16px; }
.workbench-body { height:calc(100vh - 56px); display:flex; padding:0 20px 12px; box-sizing:border-box; }.device-column { flex:0 0 var(--device-width); min-width:250px; overflow:auto; padding-right:12px; box-sizing:border-box; }
.device-card { border-radius:16px; }.device-heading {display:flex;align-items:center;gap:6px;font-size:14px;}.device-heading > span {color:#e6a23c;}.device-info {margin-left:auto; color:#909399;}
.device-stage {display:flex;align-items:flex-start;gap:8px;}.phone-display {flex:1;min-width:0;max-width:calc((100vh - 190px) * var(--screen-ratio));}.phone-display canvas {display:block;width:100%;height:auto;background:#111;border:3px solid #303338;border-radius:24px 24px 0 0;box-sizing:border-box;touch-action:none;user-select:none;}
.phone-navigation {display:flex;background:#fff;border:3px solid #303338;border-top:0;border-radius:0 0 24px 24px;overflow:hidden;}.phone-navigation .el-button {flex:1;border:0;background:transparent;margin:0;color:#909399;height:30px;}
.device-toolbar {display:flex;flex-direction:column;gap:7px;padding-top:6px;}.device-toolbar .el-button {margin:0;}.stream-status {display:flex;justify-content:space-between;gap:6px;margin-top:8px;font-size:11px;color:#666;}.online {color:#24894c;}
.splitter {flex:0 0 10px;display:flex;align-items:center;justify-content:center;cursor:col-resize;touch-action:none;border-left:2px solid #ddd;color:#aaa;}.splitter span{background:#eee;border-radius:8px;}
.operation-column {flex:1;min-width:0;padding-left:4px;}.harmony-tabs {box-shadow:none;}.control-grid {display:grid;grid-template-columns:repeat(2,minmax(230px,1fr));gap:20px;margin-top:20px;}.control-grid p {overflow-wrap:anywhere;font-size:13px;}.card-actions {display:flex;gap:10px;margin-top:16px;}.instructions {margin-top:20px;line-height:1.7;font-size:14px;}.screenshot-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px;margin-top:20px;}.screenshot-grid img{width:100%;display:block;margin-bottom:12px;}.screenshot-grid a{color:#409eff;}
.harmony-tabs :deep(.el-tabs__content) {height:100%;overflow:auto;box-sizing:border-box;}.phone-display canvas:fullscreen {width:100%;height:100%;max-height:none;object-fit:contain;border:0;border-radius:0;}
.horizontal .workbench-body {flex-direction:column;overflow:auto;}.horizontal .device-column{flex:none;width:100%;}.horizontal .device-stage{justify-content:center;}.horizontal .phone-display{flex:none;max-width:210px;}.horizontal .phone-display canvas{max-height:40vh;width:auto;max-width:100%;}.horizontal .splitter{display:none;}.horizontal .operation-column{min-height:500px;margin-top:20px;}
@media(max-width:900px){.control-grid{grid-template-columns:1fr;}.device-column{min-width:235px;}.workbench-body{padding-left:10px;padding-right:10px;}.header-content .el-tag{display:none;}}
</style>
