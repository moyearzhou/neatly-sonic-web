<script setup>
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
const props = defineProps({ ready: Boolean, blocked: Boolean, request: Function, upload: Function });
const { t } = useI18n();
const emit = defineEmits(['busy']);
const busy = ref(false), progress = ref(0), message = ref(''), failed = ref(false), remotePath = ref('');
async function perform(task) {
 if (props.blocked) return;
 busy.value = true; emit('busy', true); message.value = ''; failed.value = false; progress.value = 0;
 try { await task(); } catch (e) { failed.value = true; message.value = e.message; } finally { busy.value = false; emit('busy', false); }
}
async function push(event) {
 const file = event.target.files?.[0]; event.target.value = ''; if (!file || busy.value) return;
 await perform(async () => {
  const transfer = await props.upload(file, value => { progress.value = value; });
  const result = await props.request('push', { transfer });
  message.value = `${t('harmonyTools.sentTo')} ${result.path}`;
 });
}
async function pull() {
 await perform(async () => {
  const info = await props.request('downloadBegin', { path: remotePath.value });
  const parts = []; let offset = 0;
  try {
   while (offset < info.size) {
    const chunk = await props.request('downloadChunk', { transfer: info.transfer, offset });
    if (chunk.offset <= offset || chunk.offset > info.size) throw new Error(t('harmonyTools.transferFailed'));
    const data = Uint8Array.from(atob(chunk.data), char => char.charCodeAt(0));
    if (data.length !== chunk.offset - offset) throw new Error(t('harmonyTools.transferFailed'));
    parts.push(data); offset = chunk.offset; progress.value = Math.round(offset / info.size * 100);
   }
   const url = URL.createObjectURL(new Blob(parts)); const link = document.createElement('a');
   link.href = url; link.download = info.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
   message.value = t('harmonyTools.success');
  } finally { await props.request('cancelTransfer').catch(() => {}); }
 });
}
</script>
<template>
 <el-card><template #header><strong>{{ t('androidRemoteTS.code.fileTransfer') }}</strong></template>
  <p>{{ t('harmonyTools.fileHint') }}</p>
  <label class="file-button" :class="{ disabled: !ready || busy || blocked }">{{ t('harmonyTools.uploadFile') }}<input type="file" :disabled="!ready || busy || blocked" @change="push" /></label>
  <el-divider />
  <el-input v-model="remotePath" :disabled="busy" :placeholder="t('harmonyTools.remotePath')" />
  <el-button class="download" size="small" :disabled="!ready || busy || blocked || !remotePath" @click="pull">{{ t('harmonyTools.download') }}</el-button>
  <el-progress v-if="busy" :percentage="progress" />
  <el-alert v-if="message" :title="message" :type="failed ? 'error' : 'success'" :closable="false" />
 </el-card>
</template>
<style scoped>
p{font-size:13px;line-height:1.7;overflow-wrap:anywhere}.file-button{display:inline-block;padding:9px 12px;background:#409eff;color:#fff;border-radius:4px;cursor:pointer;font-size:13px}.file-button input{display:none}.disabled{opacity:.5;cursor:default}.download{margin:12px 0}.el-alert{margin-top:12px}
</style>
