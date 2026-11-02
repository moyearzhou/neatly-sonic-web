<script setup>
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
const props = defineProps({ ready: Boolean, blocked: Boolean, active: Boolean, request: Function, upload: Function });
const { t } = useI18n();
const emit = defineEmits(['busy']);
const apps = ref([]), query = ref(''), busy = ref(false), error = ref(''), progress = ref(0), selected = ref(null);
const filtered = computed(() => apps.value.filter(app => `${app.bundle} ${app.label || ''}`.toLowerCase().includes(query.value.toLowerCase())));
async function perform(task) {
 if (busy.value || props.blocked) return;
 busy.value = true; emit('busy', true); error.value = '';
 try { await task(); } catch (e) { error.value = e.message; } finally { busy.value = false; emit('busy', false); }
}
async function refresh() { await perform(async () => { apps.value = await props.request('listApps'); }); }
async function action(operation, app) {
 if (operation === 'uninstall' || operation === 'stop') {
  try { await ElMessageBox.confirm(t(`harmonyTools.${operation}Confirm`, { bundle: app.bundle }), t(`harmonyTools.${operation}`), { type: 'warning' }); } catch { return; }
 }
 await perform(async () => {
  progress.value = 0;
  const result = await props.request(operation, { bundle: app.bundle });
  if (operation === 'appInfo') { selected.value = result; return; }
  ElMessage.success(t('harmonyTools.success'));
  if (operation === 'uninstall') apps.value = apps.value.filter(item => item.bundle !== app.bundle);
 });
}
async function install(event) {
 const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
 if (!/\.hap$/i.test(file.name)) { error.value = t('harmonyTools.hapOnly'); return; }
 try { await ElMessageBox.confirm(t('harmonyTools.installConfirm', { name: file.name }), t('harmonyTools.install'), { type: 'warning' }); } catch { return; }
 await perform(async () => {
  progress.value = 0;
  const transfer = await props.upload(file, value => { progress.value = value; });
  await props.request('install', { transfer });
  ElMessage.success(t('harmonyTools.success'));
  apps.value = await props.request('listApps');
 });
}
watch(() => [props.active, props.ready], ([active, ready]) => { if (active && ready && !apps.value.length) refresh(); }, { immediate: true });
watch(() => props.ready, ready => { if (!ready) { apps.value = []; selected.value = null; } });
</script>
<template>
 <div class="apps-panel">
  <el-alert :title="t('harmonyTools.appHint')" type="info" :closable="false" />
  <div class="app-toolbar">
   <el-input v-model="query" clearable :placeholder="t('harmonyTools.search')" />
   <el-button :disabled="!ready || busy || blocked" :loading="busy" @click="refresh">{{ t('harmonyTools.refresh') }}</el-button>
   <label class="file-button" :class="{ disabled: !ready || busy || blocked }">{{ t('harmonyTools.install') }}<input type="file" accept=".hap" :disabled="!ready || busy || blocked" @change="install" /></label>
  </div>
  <el-progress v-if="busy && progress" :percentage="progress" />
  <el-alert v-if="error" :title="error" type="error" :closable="false" />
  <el-table :data="filtered" height="500" stripe>
   <el-table-column prop="bundle" :label="t('harmonyTools.bundle')" min-width="230" show-overflow-tooltip />
   <el-table-column :label="t('harmonyTools.actions')" width="300">
    <template #default="{ row }">
     <el-button size="mini" :disabled="!ready || busy || blocked" @click="action('appInfo', row)">{{ t('harmonyTools.details') }}</el-button>
     <el-button size="mini" type="primary" :disabled="!ready || busy || blocked" @click="action('launch', row)">{{ t('harmonyTools.launch') }}</el-button>
     <el-button size="mini" :disabled="!ready || busy || blocked" @click="action('stop', row)">{{ t('harmonyTools.stop') }}</el-button>
     <el-button size="mini" type="danger" :disabled="!ready || busy || blocked" @click="action('uninstall', row)">{{ t('harmonyTools.uninstall') }}</el-button>
    </template>
   </el-table-column>
  </el-table>
  <el-card v-if="selected" class="app-details"><p>{{ selected.label }}</p><p>{{ selected.bundle }} · {{ selected.version }}</p><p>{{ selected.ability || t('harmonyTools.noAbility') }}</p><el-tag v-if="selected.system">{{ t('harmonyTools.systemApp') }}</el-tag></el-card>
 </div>
</template>
<style scoped>
.app-toolbar{display:flex;gap:12px;margin:18px 0;align-items:center}.app-toolbar .el-input{flex:1}.file-button{display:inline-block;padding:10px 14px;background:#409eff;color:white;border-radius:4px;cursor:pointer;white-space:nowrap;font-size:14px}.file-button input{display:none}.file-button.disabled{opacity:.5;cursor:default}.app-details{margin-top:16px;overflow-wrap:anywhere}
</style>
