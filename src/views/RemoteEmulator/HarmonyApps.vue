<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
import { UploadFilled, Box } from '@element-plus/icons';
import Pageable from '@/components/Pageable.vue';
import { createAppMetadataLoader } from './HarmonyAppMetadata.mjs';
const props = defineProps({ ready: Boolean, blocked: Boolean, active: Boolean, request: Function, upload: Function });
const { t } = useI18n();
const emit = defineEmits(['busy']);
const apps = ref([]), query = ref(''), busy = ref(false), error = ref(''), progress = ref(0), installing = ref(false);
const page = ref(1), installTab = ref('upload'), dragOver = ref(false), fileInput = ref(null);
const listLoading = ref(false), detailsLoading = ref(false), listed = ref(false);
let generation = 0;
const disabled = computed(() => !props.ready || busy.value || props.blocked);
const filtered = computed(() => apps.value.filter(app => `${app.bundle} ${app.label || ''}`.toLowerCase().includes(query.value.toLowerCase())));
const pageApps = computed(() => filtered.value.slice((page.value - 1) * 7, page.value * 7));
const visibleBundles = computed(() => pageApps.value.map(app => app.bundle).join(','));
const metadata = createAppMetadataLoader({
 request: (...args) => props.request(...args),
 loading: value => { detailsLoading.value = value; },
 apply: (bundle, info) => {
  const index = apps.value.findIndex(app => app.bundle === bundle);
  if (index !== -1) apps.value[index] = { ...apps.value[index], ...info };
 },
});
async function perform(task) {
 if (busy.value || props.blocked || !props.ready) return;
 busy.value = true; emit('busy', true); error.value = ''; progress.value = 0;
 try { await task(); } catch (e) { error.value = e.message; } finally { busy.value = false; emit('busy', false); }
}
async function loadApps() {
 const current = ++generation;
 listLoading.value = true;
 metadata.reset();
 try {
  const list = await props.request('listApps');
  if (current !== generation || !props.ready) return;
  apps.value = list; page.value = 1; listed.value = true;
 } finally { if (current === generation) listLoading.value = false; }
}
async function refresh() { await perform(loadApps); }
async function action(operation, app) {
 if (disabled.value) return;
 if (operation === 'uninstall' || operation === 'stop') {
  try { await ElMessageBox.confirm(t(`harmonyTools.${operation}Confirm`, { bundle: app.bundle }), t(`harmonyTools.${operation}`), { type: 'warning' }); } catch { return; }
 }
 await perform(async () => {
  await props.request(operation, { bundle: app.bundle });
  ElMessage.success(t('harmonyTools.success'));
  if (operation === 'uninstall') apps.value = apps.value.filter(item => item.bundle !== app.bundle);
 });
}
async function install(file) {
 if (!file || disabled.value) return;
 if (!/\.hap$/i.test(file.name)) { error.value = t('harmonyTools.hapOnly'); return; }
 try { await ElMessageBox.confirm(t('harmonyTools.installConfirm', { name: file.name }), t('harmonyTools.install'), { type: 'warning' }); } catch { return; }
 await perform(async () => {
  installing.value = true;
  try {
   const transfer = await props.upload(file, value => { progress.value = value; });
   await props.request('install', { transfer });
   ElMessage.success(t('harmonyTools.success'));
  } finally { installing.value = false; }
  await loadApps();
 });
}
function choose(event) { const file = event.target.files?.[0]; event.target.value = ''; install(file); }
function drop(event) { dragOver.value = false; install(event.dataTransfer?.files?.[0]); }
watch(query, () => { page.value = 1; });
watch(() => filtered.value.length, count => { page.value = Math.min(page.value, Math.max(1, Math.ceil(count / 7))); });
watch([() => props.active, () => props.ready, () => props.blocked, busy], ([active, ready, blocked, working]) => {
 if (active && ready && !blocked && !working && !listed.value && !error.value) refresh();
}, { immediate: true });
watch([() => props.active, () => props.ready, () => props.blocked, busy, visibleBundles], () => {
 metadata.update(pageApps.value, props.active && props.ready && !props.blocked && !busy.value);
}, { immediate: true });
watch(() => props.ready, ready => {
 if (!ready) { generation++; apps.value = []; listed.value = false; listLoading.value = false; error.value = ''; metadata.reset(); }
});
onBeforeUnmount(() => { generation++; metadata.dispose(); });
</script>
<template>
 <div class="apps-panel">
  <el-tabs v-model="installTab" type="border-card" stretch class="install-tabs">
   <el-tab-pane name="upload" :label="t('androidRemoteTS.code.pushInstall')">
    <div class="upload-area">
     <div class="hap-dropzone" :class="{ dragging: dragOver, disabled }" role="button" tabindex="0" :aria-disabled="disabled"
       @click="!disabled && fileInput.click()" @keydown.enter.prevent="!disabled && fileInput.click()" @keydown.space.prevent="!disabled && fileInput.click()"
       @dragover.prevent="dragOver = !disabled" @dragleave.prevent="dragOver = false" @drop.prevent="drop">
      <el-icon class="upload-icon"><UploadFilled /></el-icon>
      <div>{{ t('harmonyApps.dragHap') }} <em>{{ t('devices.detail.uploadImg') }}</em></div>
      <input ref="fileInput" type="file" accept=".hap" :disabled="disabled" hidden @change="choose" />
     </div>
     <div class="upload-tip">{{ t('harmonyApps.hapTip') }}</div>
     <el-progress v-if="installing" :percentage="progress" class="install-progress" />
    </div>
   </el-tab-pane>
   <el-tab-pane name="url" disabled><template #label><el-tooltip :content="t('harmonyApps.urlUnavailable')"><strong>{{ t('androidRemoteTS.code.URLInstall') }}</strong></el-tooltip></template></el-tab-pane>
   <el-tab-pane name="ci" disabled><template #label><el-tooltip :content="t('harmonyApps.ciUnavailable')"><strong>{{ t('androidRemoteTS.code.linkInstall') }}</strong></el-tooltip></template></el-tab-pane>
  </el-tabs>
  <el-alert v-if="error" class="operation-error" :title="error" type="error" :closable="false" />
  <el-card shadow="hover" class="apps-table-card">
   <p v-if="detailsLoading" class="details-status" role="status">{{ t('harmonyApps.loadingPage') }}</p>
   <el-table :data="pageApps" border>
    <el-table-column width="100" header-align="center" align="center">
     <template #header><el-button size="mini" :disabled="disabled" :loading="listLoading" @click="refresh">{{ t('harmonyTools.refresh') }}</el-button></template>
     <template #default><el-avatar shape="square" :size="40" class="app-avatar" :title="t('harmonyApps.iconUnavailable')"><el-icon :size="24"><Box /></el-icon></el-avatar></template>
    </el-table-column>
    <el-table-column :label="t('androidRemoteTS.code.appName')" width="150" header-align="center" show-overflow-tooltip>
     <template #default="{ row }"><span :title="row.label === row.bundle ? t('harmonyApps.nameUnavailable') : ''">{{ row.label && row.label !== row.bundle ? row.label : '—' }}</span></template>
    </el-table-column>
    <el-table-column prop="bundle" :label="t('androidRemoteTS.code.packagesName')" min-width="230" header-align="center" show-overflow-tooltip />
    <el-table-column :label="t('androidRemoteTS.code.version')" width="120" header-align="center" show-overflow-tooltip><template #default="{ row }">{{ row.version || '—' }}</template></el-table-column>
    <el-table-column :label="t('androidRemoteTS.code.subversion')" width="120" header-align="center" show-overflow-tooltip><template #default="{ row }">{{ row.versionCode ?? '—' }}</template></el-table-column>
    <el-table-column width="260" align="center">
     <template #header><el-input v-model="query" size="mini" clearable :placeholder="t('androidRemoteTS.code.nameSearch')" /></template>
     <template #default="{ row }">
      <el-button size="mini" type="primary" :disabled="disabled" @click="action('launch', row)">{{ t('androidRemoteTS.code.open') }}</el-button>
      <el-button size="mini" type="warning" :disabled="disabled" @click="action('stop', row)">{{ t('androidRemoteTS.code.kill') }}</el-button>
      <el-button size="mini" type="danger" :disabled="disabled || row.system" :title="row.system ? t('harmonyTools.systemApp') : ''" @click="action('uninstall', row)">{{ t('androidRemoteTS.code.unInstall') }}</el-button>
     </template>
    </el-table-column>
   </el-table>
   <Pageable :is-page-set="false" :total="filtered.length" :current-page="page" :page-size="7" @change="value => page = value" />
  </el-card>
 </div>
</template>
<style scoped>
.apps-panel{min-width:0}.details-status{font-size:12px;color:#909399;margin:0 0 10px}.install-tabs :deep(.el-tabs__item){font-weight:600}.install-tabs :deep(.el-tabs__content){padding:15px;border-left:0;height:auto!important;overflow:visible}.upload-area{text-align:center;padding:0 0 2px}.hap-dropzone{box-sizing:border-box;max-width:100%;width:360px;height:180px;margin:auto;border:1px dashed #d9d9d9;border-radius:6px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:16px;cursor:pointer;font-size:14px;color:#606266;background:#fff}.hap-dropzone:hover,.hap-dropzone.dragging{border-color:#409eff;background:#f5faff}.hap-dropzone:focus-visible{outline:2px solid #409eff;outline-offset:3px}.hap-dropzone.disabled{cursor:default;background:#fafafa;color:#a8abb2}.upload-icon{font-size:60px;color:#c0c4cc}.hap-dropzone em{color:#409eff;font-style:normal}.upload-tip{font-size:12px;color:#909399;margin-top:12px}.install-progress{max-width:360px;margin:12px auto 0}.apps-table-card{margin-top:15px;border-radius:16px}.apps-table-card :deep(.el-card__body){padding:20px}.apps-table-card :deep(.el-table td){height:64px;box-sizing:border-box}.apps-table-card :deep(.el-table__row:nth-child(odd)){background:#f5f7fa}.app-avatar{background:#edf2f8;color:#909399}.operation-error{margin-top:15px}
</style>
