<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { 
    Card, Divider, Select, Button, ProgressBar, Toggle
  } from 'svelte-multistyle-ui';
  import { backend, isTauri } from '$lib/backend/api';
  import type { DownloadProgress, ModelStatus } from '$lib/backend/types';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import * as m from '$lib/paraglide/messages.js';
  import { currentLocale, toggleLang, setLang } from '$lib/i18n.svelte.ts';
  import { 
    Settings, Sliders, Cpu, Dna, FlaskConical, Globe, RefreshCw, Save, ArrowLeft, CloudDownload, Keyboard, RotateCcw, Info
  } from 'lucide-svelte';
  import { loadKeymap, saveKeymap, resetKeymap, getEventShortcutString, type Shortcut } from '$lib/gene/utils/keymap';
  import { configureSpdClient } from '$lib/spd/store.svelte';
  import { spdBaseUrl as defaultSpdBaseUrl, spdToken as storedSpdToken } from '$lib/spd/client';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import type { SpdHealth, SpdUserMe } from '$lib/spd/types';
  import { identityStore } from '$lib/identity/store.svelte';

  const ui = { style: 'pixel', theme: 'midnight' } as const;

  // ---------------- LAYOUT STATE ----------------
  let activeTab = $state<'general' | 'gene' | 'protein' | 'keymap'>('general');

  // ---------------- KEYMAP STATE ----------------
  let shortcuts = $state<Shortcut[]>([]);
  let recordingId = $state<string | null>(null);

  function startRecording(id: string) {
    recordingId = id;
    pushToast('info', m.toastRecording(), m.toastRecordingBody());
  }

  function handleRecordingKeyDown(e: KeyboardEvent) {
    if (!recordingId) return;
    e.preventDefault();
    e.stopPropagation();

    // Allow cancelling recording on Escape (except if the shortcut itself is meant to be Escape, but Escape is clear_selection)
    if (e.key === 'Escape' && recordingId !== 'clear_selection') {
      recordingId = null;
      pushToast('info', m.toastCancelled(), m.toastCancelledBody());
      return;
    }

    const str = getEventShortcutString(e);
    if (!str) return; // ignore modifier-only presses

    // Update shortcut
    const updated = shortcuts.map(s => {
      if (s.id === recordingId) {
        return { ...s, key: str };
      }
      return s;
    });

    shortcuts = updated;
    recordingId = null;

    // Check for conflicts
    const conflict = updated.find(s => s.id !== recordingId && s.key === str && s.key !== 'None');
    if (conflict) {
      pushToast('warn', m.toastConflict(), m.toastConflictBody({ str, name: conflict.name }));
    } else {
      pushToast('success', m.toastSuccess(), m.toastSuccessBody({ str }));
    }
  }

  function clearShortcut(id: string) {
    shortcuts = shortcuts.map(s => {
      if (s.id === id) {
        return { ...s, key: 'None' };
      }
      return s;
    });
    pushToast('success', m.toastCleared(), m.toastClearedBody());
  }

  function resetToDefault(id: string) {
    shortcuts = shortcuts.map(s => {
      if (s.id === id) {
        return { ...s, key: s.defaultKey };
      }
      return s;
    });
    pushToast('success', m.toastReset(), m.toastResetBody());
  }

  function resetAllToDefault() {
    shortcuts = resetKeymap();
    pushToast('success', m.toastResetAll(), m.toastResetAllBody());
  }

  // ---------------- GENERAL SETTINGS ----------------
  const THEMES = ['midnight', 'default', 'ocean', 'forest', 'rose', 'gold', 'slate', 'candy', 'storm', 'royal'];
  const MODES = ['dark', 'light', 'system'];
  
  let theme = $state((typeof localStorage !== 'undefined' && localStorage.getItem('spice_theme')) || 'midnight');
  let mode = $state((typeof localStorage !== 'undefined' && localStorage.getItem('spice_mode')) || 'dark');
  let modelUrl = $state((typeof localStorage !== 'undefined' && localStorage.getItem('spice_model_url')) || '');
  let modelPathInput = $state('');
  let dlProgress = $state<DownloadProgress | null>(null);
  let dlBusy = $state(false);
  let dlMsg = $state<string | null>(null);
  let dlOk = $state(true);
  let modelCands = $state<string[]>([]);
  let modelStatus = $state<ModelStatus | null>(null);
  let statusBusy = $state(false);

  // ---------------- PUBLIC INTEGRATIONS ----------------
  let spdBaseUrl = $state(defaultSpdBaseUrl());
  let spdApiToken = $state(storedSpdToken());
  let spdHealth = $state<SpdHealth | null>(null);
  let spdUser = $state<SpdUserMe | null>(null);
  let spdBusy = $state(false);
  let spdError = $state<string | null>(null);
  let orcidInput = $state((typeof localStorage !== 'undefined' && localStorage.getItem('spice_orcid')) || '');
  const identity = identityStore;

  function openSpdSite() {
    const url = 'https://d.spicebio.top';
    if (isTauri()) void openUrl(url);
    else window.open(url, '_blank', 'noopener');
  }

  async function checkSpdHealth() {
    spdBusy = true; spdError = null; spdHealth = null;
    try {
      const health = await configureSpdClient({ baseUrl: spdBaseUrl.trim() || defaultSpdBaseUrl(), token: '' }).health();
      spdHealth = health;
      if (typeof localStorage !== 'undefined') localStorage.setItem('spice_spd_base_url', spdBaseUrl.trim() || defaultSpdBaseUrl());
    } catch (error) {
      spdError = error instanceof Error ? error.message : String(error);
    } finally { spdBusy = false; }
  }

  async function verifySpdToken() {
    const token = spdApiToken.trim();
    if (!token) { spdError = m.spdTokenMissing(); return; }
    spdBusy = true; spdError = null; spdUser = null;
    try {
      const base = spdBaseUrl.trim() || defaultSpdBaseUrl();
      spdUser = await configureSpdClient({ baseUrl: base, token }).me();
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('spice_spd_api_token', token);
        localStorage.setItem('spice_spd_base_url', base);
      }
    } catch (error) {
      spdError = error instanceof Error ? error.message : String(error);
    } finally { spdBusy = false; }
  }

  async function loadOrcidProfile() {
    identity.setOrcid(orcidInput);
    localStorage.setItem('spice_orcid', identity.value.orcid);
    try { await identity.load(); } catch { /* state exposes the public-client error */ }
  }

  // ---------------- GENE SETTINGS ----------------
  let defaultHost = $state((typeof localStorage !== 'undefined' && localStorage.getItem('spice_default_host')) || 'ecoli');
  let monovalentM = $state((typeof localStorage !== 'undefined' && localStorage.getItem('spice_monovalent_m')) || '0.05');
  let divalentM = $state((typeof localStorage !== 'undefined' && localStorage.getItem('spice_divalent_m')) || '0.0015');
  let primerM = $state((typeof localStorage !== 'undefined' && localStorage.getItem('spice_primer_m')) || '0.0000005');
  let gelExportMultiplier = $state((typeof localStorage !== 'undefined' && localStorage.getItem('spice_gel_export_multiplier')) || '4');
  let autoSaveGeneProj = $state((typeof localStorage !== 'undefined' && localStorage.getItem('spice_auto_save_gene_proj') === 'true'));
  let forceVirtualKeyboard = $state((typeof localStorage !== 'undefined' && localStorage.getItem('spice_force_virtual_keyboard') === 'true'));
  let isSyncingRebase = $state(false);
  let rebaseCount = $state((typeof localStorage !== 'undefined' && Number(localStorage.getItem('spice_rebase_count'))) || 820);

  // Sync states for CARD AMR and IGSC Biosecurity databases (Feature 19)
  let isSyncingCardAmr = $state(false);
  let cardAmrCount = $state((typeof localStorage !== 'undefined' && Number(localStorage.getItem('spice_card_amr_count'))) || 5);
  let isSyncingBiosecurity = $state(false);
  let biosecurityCount = $state((typeof localStorage !== 'undefined' && Number(localStorage.getItem('spice_biosecurity_count'))) || 4);

  // ---------------- PROTEIN SETTINGS ----------------
  let integrationStep = $state((typeof localStorage !== 'undefined' && localStorage.getItem('spice_integration_step')) || '1.0');
  let thermostatConstant = $state((typeof localStorage !== 'undefined' && localStorage.getItem('spice_thermostat_constant')) || '0.1');
  let solventPruningThreshold = $state((typeof localStorage !== 'undefined' && localStorage.getItem('spice_solvent_pruning')) || '2.2');
  let madFactor = $state((typeof localStorage !== 'undefined' && localStorage.getItem('spice_mad_factor')) || '1.4826');

  function applyTheme() {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('spice_theme', theme);
      localStorage.setItem('spice_mode', mode);
    }
    const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.classList.toggle('light', !dark);
  }

  $effect(() => {
    applyTheme();
  });

  onMount(async () => {
    applyTheme();
    statusBusy = true;
    modelStatus = (await backend.modelStatus()).data ?? null;
    modelCands = await backend.modelCandidates();
    statusBusy = false;
    shortcuts = loadKeymap();
    // A saved ORCID re-verifies automatically so the ELN author field is
    // enabled without a manual click after each app start.
    if (orcidInput.trim()) void loadOrcidProfile();
  });

  async function checkModel() {
    statusBusy = true;
    modelStatus = (await backend.modelStatus()).data ?? null;
    statusBusy = false;
  }

  async function applyModelPath() {
    const r = await backend.setModelPath(modelPathInput);
    dlMsg = r.data?.ok ? m.toastModelLoadSuccessMsg() : m.toastModelLoadingError({ error: r.data?.error ?? 'Unknown' });
    if (r.data?.ok) {
      modelStatus = (await backend.modelStatus()).data ?? null;
      pushToast('success', m.toastModelLoaded(), modelStatus?.modelPath ?? modelPathInput);
    } else {
      pushToast('error', m.toastModelLoadFailed(), r.data?.error ?? 'Unknown');
    }
  }

  async function doDownload() {
    if (!modelUrl.trim()) {
      dlMsg = m.toastUrlEmpty();
      return;
    }
    dlBusy = true;
    dlMsg = null;
    dlProgress = null;
    const r = await backend.downloadModel(modelUrl.trim(), null, (p: DownloadProgress) => (dlProgress = p));
    dlBusy = false;
    if (r.error) {
      dlMsg = m.toastDownloadFailedBody({ error: r.error });
      dlOk = false;
      pushToast('error', m.toastDownloadFailed(), r.error);
    } else {
      dlMsg = m.toastDownloadSuccessBody({ path: r.data });
      dlOk = true;
      modelPathInput = r.data;
      pushToast('success', m.toastDownloadSuccess(), r.data);
    }
    await checkModel();
  }

  async function handleSyncRebase() {
    isSyncingRebase = true;
    pushToast('success', m.toastSyncRebase(), m.toastSyncRebaseBody());
    try {
      const res = await backend.syncRebaseDb();
      rebaseCount = res.data.length;
      localStorage.setItem('spice_rebase_count', String(rebaseCount));
      localStorage.setItem('spice_rebase_db', JSON.stringify(res.data));
      pushToast('success', m.toastSyncRebaseSuccess(), m.toastSyncRebaseSuccessBody({ n: rebaseCount }));
    } catch (e: any) {
      pushToast('error', m.toastSyncRebaseFailed(), e.message ?? e);
    } finally {
      isSyncingRebase = false;
    }
  }

  async function handleSyncCardAmr() {
    isSyncingCardAmr = true;
    pushToast('success', m.toastSyncCard(), m.toastSyncCardBody());
    try {
      const res = await backend.syncCardAmrDb();
      cardAmrCount = res.data.length;
      localStorage.setItem('spice_card_amr_count', String(cardAmrCount));
      localStorage.setItem('spice_card_amr_db', JSON.stringify(res.data));
      pushToast('success', m.toastSyncCardSuccess(), m.toastSyncCardSuccessBody({ n: cardAmrCount }));
    } catch (e: any) {
      pushToast('error', m.toastSyncCardFailed(), e.message ?? e);
    } finally {
      isSyncingCardAmr = false;
    }
  }

  async function handleSyncBiosecurity() {
    isSyncingBiosecurity = true;
    pushToast('success', m.toastSyncIgsc(), m.toastSyncIgscBody());
    try {
      const res = await backend.syncBiosecurityDb();
      biosecurityCount = res.data.length;
      localStorage.setItem('spice_biosecurity_count', String(biosecurityCount));
      localStorage.setItem('spice_biosecurity_db', JSON.stringify(res.data));
      pushToast('success', m.toastSyncIgscSuccess(), m.toastSyncIgscSuccessBody({ n: biosecurityCount }));
    } catch (e: any) {
      pushToast('error', m.toastSyncIgscFailed(), e.message ?? e);
    } finally {
      isSyncingBiosecurity = false;
    }
  }

  // Personal Custom Enzyme Sets Export & Import (Settings Integration)
  let importInput = $state<HTMLInputElement | null>(null);

  function exportEnzymeSets() {
    const saved = localStorage.getItem('spice.gene.customEnzymeSetsGrid');
    if (!saved || saved === '[]') {
      pushToast('error', m.toastExportFailed(), m.toastExportFailedBody());
      return;
    }
    const blob = new Blob([saved], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `custom_enzyme_sets_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    pushToast('success', m.toastExportSuccess(), m.toastExportSuccessBody());
  }

  function importEnzymeSets(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) {
          throw new Error(m.toastImportInvalidStructure());
        }
        // Validate items
        const isValid = parsed.every(item => typeof item.name === 'string' && Array.isArray(item.enzymes));
        if (!isValid) {
          throw new Error(m.toastImportInvalidItems());
        }

        // Merge existing and imported
        const existingRaw = localStorage.getItem('spice.gene.customEnzymeSetsGrid') || '[]';
        let existing: { name: string; enzymes: string[] }[] = [];
        try { existing = JSON.parse(existingRaw); } catch {}

        const mergedMap = new Map<string, string[]>();
        existing.forEach(item => mergedMap.set(item.name, item.enzymes));
        parsed.forEach(item => mergedMap.set(item.name, item.enzymes));

        const mergedList = Array.from(mergedMap.entries()).map(([name, enzymes]) => ({ name, enzymes }));
        localStorage.setItem('spice.gene.customEnzymeSetsGrid', JSON.stringify(mergedList));

        pushToast('success', m.toastImportSuccess(), m.toastImportSuccessBody({ n: parsed.length }));
      } catch (err: any) {
        pushToast('error', m.toastImportFailed(), err.message ?? err);
      }
    };
    reader.readAsText(file);
    if (importInput) importInput.value = ''; // Reset file input
  }

  function saveAllSettings() {
    try {
      localStorage.setItem('spice_default_host', defaultHost);
      localStorage.setItem('spice_monovalent_m', monovalentM);
      localStorage.setItem('spice_divalent_m', divalentM);
      localStorage.setItem('spice_primer_m', primerM);
      localStorage.setItem('spice_gel_export_multiplier', gelExportMultiplier);
      localStorage.setItem('spice_auto_save_gene_proj', autoSaveGeneProj ? 'true' : 'false');
      localStorage.setItem('spice_force_virtual_keyboard', forceVirtualKeyboard ? 'true' : 'false');
      localStorage.setItem('spice_model_url', modelUrl);
      // ELN author name is only ever written from a verified ORCID profile.
      if (identity.value.profile) localStorage.setItem('spice_author_name', identity.displayName);
      const spdBase = spdBaseUrl.trim() || defaultSpdBaseUrl();
      localStorage.setItem('spice_spd_base_url', spdBase);
      localStorage.setItem('spice_spd_api_token', spdApiToken.trim());
      localStorage.setItem('spice_orcid', orcidInput);

      localStorage.setItem('spice_integration_step', integrationStep);
      localStorage.setItem('spice_thermostat_constant', thermostatConstant);
      localStorage.setItem('spice_solvent_pruning', solventPruningThreshold);
      localStorage.setItem('spice_mad_factor', madFactor);

      saveKeymap(shortcuts);

      pushToast('success', m.toastSaveSettingsSuccess(), m.toastSaveSettingsSuccessBody());
    } catch (e: any) {
      pushToast('error', m.toastSaveSettingsFailed(), e.message);
    }
  }

  function fmtBytes(b?: number | null): string {
    if (b == null) return '—';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  }
</script>

<svelte:window onkeydown={(e) => { if (recordingId) handleRecordingKeyDown(e); }} />

<div class="settings-page" style="display: flex; flex-direction: column; gap: 8px; padding: 12px 12px 48px 12px; font-family: var(--pix-font); height: 100%; box-sizing: border-box; overflow-y: auto; background: var(--pix-bg-1);">
  <!-- Back and Header Row -->
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
    <button class="pix-btn-reset" onclick={() => goto('/')} style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: bold; color: var(--pix-cyan);">
      <ArrowLeft size={12} /> {m.appSettings()} / {m.backToWorkspace()}
    </button>
    <button class="pix-btn ok" onclick={saveAllSettings} style="padding: 4px 12px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;">
      <Save size={11} /> {m.saveAllConfigs()}
    </button>
  </div>

  <div class="settings-split-container" style="display: flex; gap: 12px; min-height: 0; align-items: flex-start; width: 100%;">
    <!-- Left Narrow Sidebar (Categories) -->
    <div class="settings-sidebar" style="width: 180px; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0;">
      <button 
        class="pix-sidebar-btn" 
        class:active={activeTab === 'general'}
        onclick={() => activeTab = 'general'}
        style={activeTab === 'general' ? 'border-color: var(--pix-accent-2); color: #fff; background: rgba(226, 180, 72, 0.15); font-weight: bold; box-shadow: 0 0 6px rgba(226, 180, 72, 0.3);' : ''}
      >
        <Globe size={13} style={activeTab === 'general' ? 'color: var(--pix-accent-2)' : ''} /> {m.tabGeneral()}
      </button>
      <button 
        class="pix-sidebar-btn" 
        class:active={activeTab === 'gene'}
        onclick={() => activeTab = 'gene'}
        style={activeTab === 'gene' ? 'border-color: var(--pix-cyan); color: #fff; background: rgba(76, 214, 255, 0.15); font-weight: bold; box-shadow: 0 0 6px rgba(76, 214, 255, 0.3);' : ''}
      >
        <Dna size={13} style={activeTab === 'gene' ? 'color: var(--pix-cyan)' : ''} /> {m.tabGene()}
      </button>
      <button 
        class="pix-sidebar-btn" 
        class:active={activeTab === 'protein'}
        onclick={() => activeTab = 'protein'}
        style={activeTab === 'protein' ? 'border-color: var(--pix-accent); color: #fff; background: rgba(166, 76, 255, 0.15); font-weight: bold; box-shadow: 0 0 6px rgba(166, 76, 255, 0.3);' : ''}
      >
        <FlaskConical size={13} style={activeTab === 'protein' ? 'color: var(--pix-accent)' : ''} /> {m.tabProtein()}
      </button>
      <button 
        class="pix-sidebar-btn" 
        class:active={activeTab === 'keymap'}
        onclick={() => activeTab = 'keymap'}
        style={activeTab === 'keymap' ? 'border-color: #ff5df6; color: #fff; background: rgba(255, 93, 246, 0.15); font-weight: bold; box-shadow: 0 0 6px rgba(255, 93, 246, 0.3);' : ''}
      >
        <Keyboard size={13} style={activeTab === 'keymap' ? 'color: #ff5df6' : ''} /> {m.keymapSettings()}
      </button>
    </div>

    <!-- Right Wide Content Area -->
    <div class="settings-content" style="flex: 1; min-width: 0;">
      {#if activeTab === 'general'}
        <!-- ============ SECTION 1: GENERAL SETTINGS ============ -->
        <Card {...ui} padding="16px">
          {#snippet children()}
            <div class="pix-title" style="color: var(--pix-accent-2); display: flex; align-items: center; gap: 4px; font-size: 13px;">
              <Globe size={14} /> {m.tabGeneral()}
            </div>
            <Divider {...ui} />

            <div style="display: flex; flex-direction: column; gap: 12px; font-size: 11px;">
              <!-- Language Selection -->
              <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(226, 180, 72, 0.04); padding: 8px; border: 1px dashed var(--pix-border); border-radius: 3px;">
                <span class="pix-dim" style="font-weight: bold;">{m.interfaceLanguage()}</span>
                <select 
                  class="pix-select" 
                  value={currentLocale.value} 
                  onchange={(e) => setLang(e.currentTarget.value)}
                  style="padding: 2px 4px; font-weight: bold; color: var(--pix-cyan); background: #000; border: 1px solid var(--pix-border); border-radius: 3px; cursor: pointer; outline: none; height: 22px; font-size: 10px; min-width: 100px;"
                >
                  <option value="zh">{m.langZh()}</option>
                  <option value="en">{m.langEn()}</option>
                  <option value="ja">{m.langJa()}</option>
                  <option value="ko">{m.langKo()}</option>
                  <option value="de">{m.langDe()}</option>
                  <option value="nl">{m.langNl()}</option>
                  <option value="sv">{m.langSv()}</option>
                </select>
              </div>

              <!-- Theme Selection -->
              <div style="display: flex; flex-direction: column; gap: 4px;">
                <span class="pix-dim" style="font-weight: bold;">{m.themePalette()}</span>
                <select class="pix-select" bind:value={theme} style="padding: 4px 6px; width: 100%;">
                  {#each THEMES as t}
                    <option value={t}>{t.toUpperCase()}</option>
                  {/each}
                </select>
              </div>

              <!-- Mode Selection -->
              <div style="display: flex; flex-direction: column; gap: 4px;">
                <span class="pix-dim" style="font-weight: bold;">{m.displayMode()}</span>
                <select class="pix-select" bind:value={mode} style="padding: 4px 6px; width: 100%;">
                  {#each MODES as m}
                    <option value={m}>{m.toUpperCase()}</option>
                  {/each}
                </select>
              </div>

              <!-- ELN Author — bound to the verified ORCID profile name -->
              <div style="display: flex; flex-direction: column; gap: 4px;">
                <span class="pix-dim" style="font-weight: bold;">{m.elnDefaultAuthorLabel()}</span>
                <input
                  class="pix-input"
                  type="text"
                  readonly
                  disabled={!identity.value.profile}
                  value={identity.value.profile ? identity.displayName : ''}
                  placeholder={m.elnDefaultAuthorPlaceholder()}
                  title={m.elnAuthorLockedHint()}
                  style="width: 100%; padding: 4px 6px; {identity.value.profile ? '' : 'opacity: 0.45; cursor: not-allowed;'}"
                />
                <span class="pix-dim" style="font-size: 9px; line-height: 1.4;">{m.elnAuthorLockedHint()}</span>
              </div>

              <Divider {...ui} />

              <!-- ONNX Neural Network Model path settings -->
              <div class="pix-title" style="font-size: 11px; font-weight: bold; color: var(--pix-accent-2);">{m.onnxFolderHub()}</div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
                <span class="pix-dim">{m.modelLoadStatus()}</span>
                <div style="display: flex; align-items: center; gap: 4px;">
                  <span class="pix-led {modelStatus?.ok ? 'ok' : 'bad'}" style="width:8px;height:8px"></span>
                  <span>{modelStatus?.ok ? m.statusLoaded() : m.statusOffline()}</span>
                </div>
              </div>

              {#if modelStatus?.ok}
                <div class="mono pix-dim" style="font-size: 8px; word-break: break-all; background: rgba(0,0,0,0.2); padding: 6px; border-radius: 2px; border: 1px solid rgba(255,255,255,0.05); line-height: 1.4;">
                  {m.modelPathLabel()} {modelStatus.modelPath}<br/>
                  {m.modelSizeLabel()} {fmtBytes(modelStatus.sizeBytes)}<br/>
                  {m.modelHeadsLabel()} {modelStatus.trainedHeads?.join(', ')}
                </div>
              {/if}

              <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
                <span class="pix-dim">{m.manualModelPath()}</span>
                <div style="display: flex; gap: 6px;">
                  <input class="pix-input" type="text" bind:value={modelPathInput} placeholder="…/spice_infer_fixed.onnx" style="flex: 1; padding: 4px 6px;" />
                  <button class="pix-btn-reset" onclick={applyModelPath} style="padding: 4px 12px; background: rgba(255,255,255,0.05); border: 1px solid var(--pix-border);">{m.apply()}</button>
                </div>
              </div>

              <Divider {...ui} />
              <div class="pix-title" style="font-size: 11px; font-weight: bold; color: var(--pix-accent-2);">{m.downloadModelFromCloud()}</div>
              <div style="display: flex; flex-direction: column; gap: 4px;">
                <span class="pix-dim">{m.modelUrlLabel()}</span>
                <div style="display: flex; gap: 6px;">
                  <input class="pix-input" type="text" bind:value={modelUrl} placeholder="https://…/spice_infer_fixed.onnx" style="flex: 1; padding: 4px 6px;" />
                  <button class="pix-btn-reset" disabled={dlBusy} onclick={doDownload} style="padding: 4px 12px; background: rgba(255,255,255,0.05); border: 1px solid var(--pix-border);">
                    {dlBusy ? m.downloading() : m.download()}
                  </button>
                </div>
              </div>

              {#if dlProgress}
                <ProgressBar {...ui} value={dlProgress.total ? (dlProgress.done / dlProgress.total) * 100 : -1} size="md" />
                <div class="pix-dim" style="font-size: 8px; text-align: center;">
                  {m.downloadCompleted()} {fmtBytes(dlProgress.done)} / {dlProgress.total ? fmtBytes(dlProgress.total) : '—'}
                </div>
              {/if}

              {#if dlMsg}
                <div class="pix-num {dlOk ? 'good' : 'bad'}" style="font-size: 9px; word-break: break-all;">{dlMsg}</div>
              {/if}

              <Divider {...ui} />
              <div class="pix-title" style="font-size: 11px; font-weight: bold; color: var(--pix-accent-2);">{m.publicIntegrationsTitle()}</div>
              <div style="display: flex; flex-direction: column; gap: 4px;">
                <span class="pix-dim">{m.spdBaseUrlLabel()}</span>
                <div style="display: flex; gap: 6px;">
                  <input class="pix-input" type="url" bind:value={spdBaseUrl} placeholder={defaultSpdBaseUrl()} style="flex: 1; padding: 4px 6px;" />
                  <button class="pix-btn-reset" disabled={spdBusy} onclick={checkSpdHealth} style="padding: 4px 12px; background: rgba(255,255,255,0.05); border: 1px solid var(--pix-border);">{spdBusy ? m.checking() : m.checkHealth()}</button>
                </div>
                {#if spdHealth}<div class="pix-num good" style="font-size: 9px;">{spdHealth.service} · {spdHealth.status}{spdHealth.apiVersion ? ` · v${spdHealth.apiVersion}` : ''}</div>{/if}

                <span class="pix-dim">{m.spdTokenLabel()}</span>
                <div style="display: flex; gap: 6px;">
                  <input class="pix-input" type="password" bind:value={spdApiToken} placeholder={m.spdTokenPlaceholder()} style="flex: 1; padding: 4px 6px; font-family: monospace;" />
                  <button class="pix-btn-reset" disabled={spdBusy} onclick={verifySpdToken} style="padding: 4px 12px; background: rgba(255,255,255,0.05); border: 1px solid var(--pix-border);">{spdBusy ? m.checking() : m.spdVerifyToken()}</button>
                </div>
                <div class="pix-dim" style="font-size: 9px; line-height: 1.4;">{m.spdTokenGuide()}
                  <button class="pix-btn-reset" onclick={openSpdSite} style="margin-left: 4px; color: var(--pix-cyan); border-color: var(--pix-cyan); font-size: 9px; padding: 1px 6px;">{m.spdTokenLink()}</button>
                </div>
                {#if spdUser}
                  <div class="pix-num good" style="font-size: 9px; word-break: break-all;">{m.spdIdentityOk({ v1: spdUser.user.displayName || spdUser.user.orcidId || spdUser.user.id || '?', v2: (spdUser.roles || []).map((r) => r.role).join(', ') || 'user' })}</div>
                {/if}
                {#if spdError}<div class="pix-num bad" style="font-size: 9px; word-break: break-all;">{spdError}</div>{/if}
              </div>

              <div style="display: flex; flex-direction: column; gap: 4px;">
                <span class="pix-dim">{m.orcidLabel()}</span>
                <div style="display: flex; gap: 6px;">
                  <input class="pix-input" type="text" bind:value={orcidInput} placeholder="0000-0000-0000-0000" style="flex: 1; padding: 4px 6px;" />
                  <button class="pix-btn-reset" disabled={identity.value.loading} onclick={loadOrcidProfile} style="padding: 4px 12px; background: rgba(255,255,255,0.05); border: 1px solid var(--pix-border);">{identity.value.loading ? m.loading() : m.loadProfile()}</button>
                </div>
                {#if identity.value.profile}<div class="pix-num good" style="font-size: 9px; word-break: break-word;">{identity.value.profile.creditName || [identity.value.profile.givenNames, identity.value.profile.familyName].filter(Boolean).join(' ') || identity.value.profile.orcid}{identity.value.profile.institution ? ` · ${identity.value.profile.institution}` : ''}</div>{/if}
                {#if identity.value.error}<div class="pix-num bad" style="font-size: 9px; word-break: break-all;">{identity.value.error}</div>{/if}
              </div>
            </div>
          {/snippet}
        </Card>
      {:else if activeTab === 'gene'}
        <!-- ============ SECTION 2: GENE SETTINGS ============ -->
        <Card {...ui} padding="16px">
          {#snippet children()}
            <div class="pix-title" style="color: var(--pix-cyan); display: flex; align-items: center; gap: 4px; font-size: 13px;">
              <Dna size={14} /> {m.tabGene()}
            </div>
            <Divider {...ui} />

            <div style="display: flex; flex-direction: column; gap: 12px; font-size: 11px;">
              <!-- REBASE database sync and details -->
              <div class="pix-title" style="font-size: 11px; font-weight: bold; color: var(--pix-cyan);">{m.rebaseSyncTitle()}</div>
              <div class="pix-dim" style="line-height: 1.3;">
                {m.rebaseSyncDesc()}
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.15); padding: 8px; border: 1px dashed var(--pix-border); border-radius: 3px;">
                <span class="pix-dim">{m.cachedEnzymes()}</span>
                <span class="pix-num" style="color: var(--pix-green); font-size: 12px; font-weight: bold;">{rebaseCount} {m.unitKinds()}</span>
              </div>

              <button 
                class="pix-btn" 
                disabled={isSyncingRebase} 
                onclick={handleSyncRebase} 
                style="width: 100%; padding: 6px; display: inline-flex; align-items: center; justify-content: center; gap: 6px;"
              >
                <RefreshCw size={11} class={isSyncingRebase ? 'spin' : ''} /> {isSyncingRebase ? m.syncing() : m.syncRebaseBtn()}
              </button>

              <Divider {...ui} />

              <!-- CARD AMR Database Sync -->
              <div class="pix-title" style="font-size: 11px; font-weight: bold; color: var(--pix-cyan);">{m.cardSyncTitle()}</div>
              <div class="pix-dim" style="line-height: 1.3;">
                {m.cardSyncDesc()}
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.15); padding: 8px; border: 1px dashed var(--pix-border); border-radius: 3px;">
                <span class="pix-dim">{m.cachedCardAmr()}</span>
                <span class="pix-num" style="color: var(--pix-green); font-size: 12px; font-weight: bold;">{cardAmrCount} {m.unitKinds()}</span>
              </div>

              <button 
                class="pix-btn" 
                disabled={isSyncingCardAmr} 
                onclick={handleSyncCardAmr} 
                style="width: 100%; padding: 6px; display: inline-flex; align-items: center; justify-content: center; gap: 6px;"
              >
                <RefreshCw size={11} class={isSyncingCardAmr ? 'spin' : ''} /> {isSyncingCardAmr ? m.syncing() : m.syncCardBtn()}
              </button>

              <Divider {...ui} />

              <!-- IGSC Biosecurity Database Sync -->
              <div class="pix-title" style="font-size: 11px; font-weight: bold; color: var(--pix-cyan);">{m.igscSyncTitle()}</div>
              <div class="pix-dim" style="line-height: 1.3;">
                {m.igscSyncDesc()}
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.15); padding: 8px; border: 1px dashed var(--pix-border); border-radius: 3px;">
                <span class="pix-dim">{m.cachedBiosecurity()}</span>
                <span class="pix-num" style="color: var(--pix-green); font-size: 12px; font-weight: bold;">{biosecurityCount} {m.unitKinds()}</span>
              </div>

              <button 
                class="pix-btn" 
                disabled={isSyncingBiosecurity} 
                onclick={handleSyncBiosecurity} 
                style="width: 100%; padding: 6px; display: inline-flex; align-items: center; justify-content: center; gap: 6px;"
              >
                <RefreshCw size={11} class={isSyncingBiosecurity ? 'spin' : ''} /> {isSyncingBiosecurity ? m.syncing() : m.syncIgscBtn()}
              </button>

              <Divider {...ui} />

              <div class="pix-title" style="font-size: 11px; font-weight: bold; color: var(--pix-cyan);">{m.primerThermodynamicsTitle()}</div>
              
              <!-- Default Codon Host selection -->
              <div style="display: flex; flex-direction: column; gap: 4px;">
                <span class="pix-dim">{m.defaultHostLabel()}</span>
                <select class="pix-select" bind:value={defaultHost} style="padding: 4px 6px; width: 100%;">
                  <option value="ecoli">{m.hostEcoli()}</option>
                  <option value="yeast">{m.hostYeast()}</option>
                  <option value="human">{m.hostHuman()}</option>
                </select>
              </div>

              <!-- Salt parameters -->
              <div style="display: flex; flex-direction: column; gap: 4px;">
                <span class="pix-dim">{m.monovalentLabel()}</span>
                <input class="pix-input" type="text" bind:value={monovalentM} placeholder="0.05" style="padding: 4px 6px; font-family: monospace;" />
              </div>

              <div style="display: flex; flex-direction: column; gap: 4px;">
                <span class="pix-dim">{m.divalentLabel()}</span>
                <input class="pix-input" type="text" bind:value={divalentM} placeholder="0.0015" style="padding: 4px 6px; font-family: monospace;" />
              </div>

              <div style="display: flex; flex-direction: column; gap: 4px;">
                <span class="pix-dim">{m.primerConcLabel()}</span>
                <input class="pix-input" type="text" bind:value={primerM} placeholder="0.0000005" style="padding: 4px 6px; font-family: monospace;" />
              </div>

              <Divider {...ui} />

              <div class="pix-title" style="font-size: 11px; font-weight: bold; color: var(--pix-cyan);">{m.gelExportTitle()}</div>
              
              <div style="display: flex; flex-direction: column; gap: 4px;">
                <span class="pix-dim">{m.gelSuperResLabel()}</span>
                <select class="pix-select" bind:value={gelExportMultiplier} style="padding: 4px 6px; width: 100%;">
                  <option value="1">{m.resStandard()}</option>
                  <option value="2">{m.resHD()}</option>
                  <option value="4">{m.resUHD()}</option>
                  <option value="8">{m.resSuper()}</option>
                </select>
              </div>

              <Divider {...ui} />

              <div class="pix-title" style="font-size: 11px; font-weight: bold; color: var(--pix-cyan);">{m.genePrefsTitle()}</div>
              
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; background: rgba(76, 214, 255, 0.04); padding: 8px; border: 1px dashed var(--pix-border); border-radius: 3px;">
                <div style="flex: 1; padding-right: 10px;">
                  <span class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.autoSaveLabel()}</span>
                  <div style="font-size: 8.5px; opacity: 0.6; margin-top: 1px; line-height: 1.3;">{m.autoSaveDesc()}</div>
                </div>
                <Toggle {...ui} bind:checked={autoSaveGeneProj} label="" />
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; background: rgba(76, 214, 255, 0.04); padding: 8px; border: 1px dashed var(--pix-border); border-radius: 3px;">
                <div style="flex: 1; padding-right: 10px;">
                  <span class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.forceVkLabel()}</span>
                  <div style="font-size: 8.5px; opacity: 0.6; margin-top: 1px; line-height: 1.3;">{m.forceVkDesc()}</div>
                </div>
                <Toggle {...ui} bind:checked={forceVirtualKeyboard} label="" />
              </div>

              <Divider {...ui} />

              <div class="pix-title" style="font-size: 11px; font-weight: bold; color: var(--pix-cyan);">{m.customEnzymesTitle()}</div>
              <div class="pix-dim" style="line-height: 1.3;">
                {m.customEnzymesDesc()}
              </div>

              <div style="display: flex; gap: 8px;">
                <button class="pix-btn" onclick={exportEnzymeSets} style="flex: 1; padding: 6px; font-size: 10px; display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
                  {m.exportEnzymesBtn()}
                </button>
                <button class="pix-btn" onclick={() => importInput?.click()} style="flex: 1; padding: 6px; font-size: 10px; display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
                  {m.importEnzymesBtn()}
                </button>
                <input 
                  type="file" 
                  accept=".json" 
                  bind:this={importInput} 
                  onchange={importEnzymeSets} 
                  style="display: none;" 
                />
              </div>
            </div>
          {/snippet}
        </Card>
      {:else if activeTab === 'protein'}
        <!-- ============ SECTION 3: PROTEIN SETTINGS ============ -->
        <Card {...ui} padding="16px">
          {#snippet children()}
            <div class="pix-title" style="color: var(--pix-accent); display: flex; align-items: center; gap: 4px; font-size: 13px;">
              <FlaskConical size={14} /> {m.tabProtein()}
            </div>
            <Divider {...ui} />

            <div style="display: flex; flex-direction: column; gap: 12px; font-size: 11px;">
              <div class="pix-title" style="font-size: 11px; font-weight: bold; color: var(--pix-accent);">{m.mdStepTitle()}</div>
              <div class="pix-dim" style="line-height: 1.3;">
                {m.mdStepDesc()}
              </div>

              <!-- Integration step size -->
              <div style="display: flex; flex-direction: column; gap: 4px;">
                <span class="pix-dim">{m.integrationStepLabel()}</span>
                <select class="pix-select" bind:value={integrationStep} style="padding: 4px 6px; width: 100%;">
                  <option value="1.0">{m.stepPrecision()}</option>
                  <option value="2.0">{m.stepBalanced()}</option>
                  <option value="4.0">{m.stepExtreme()}</option>
                </select>
              </div>

              <Divider {...ui} />

              <div class="pix-title" style="font-size: 11px; font-weight: bold; color: var(--pix-accent);">{m.berendsenTitle()}</div>
              <div style="display: flex; flex-direction: column; gap: 4px;">
                <span class="pix-dim">{m.thermostatTauLabel()}</span>
                <input class="pix-input" type="text" bind:value={thermostatConstant} placeholder="0.1" style="padding: 4px 6px; font-family: monospace;" />
              </div>

              <Divider {...ui} />

              <div class="pix-title" style="font-size: 11px; font-weight: bold; color: var(--pix-accent);">{m.solventPruningTitle()}</div>
              <div class="pix-dim" style="line-height: 1.3;">
                {m.solventPruningDesc()}
              </div>
              <div style="display: flex; flex-direction: column; gap: 4px;">
                <span class="pix-dim">{m.solventPruningLabel()}</span>
                <input class="pix-input" type="text" bind:value={solventPruningThreshold} placeholder="2.2" style="padding: 4px 6px; font-family: monospace;" />
              </div>

              <Divider {...ui} />

              <div class="pix-title" style="font-size: 11px; font-weight: bold; color: var(--pix-accent);">{m.healthMetricsTitle()}</div>
              <div style="display: flex; flex-direction: column; gap: 4px;">
                <span class="pix-dim">{m.madFactorLabel()}</span>
                <input class="pix-input" type="text" bind:value={madFactor} placeholder="1.4826" style="padding: 4px 6px; font-family: monospace;" />
              </div>
            </div>
          {/snippet}
        </Card>
      {:else if activeTab === 'keymap'}
        <!-- ============ SECTION 4: KEYMAP SETTINGS ============ -->
        <Card {...ui} padding="16px">
          {#snippet children()}
            <div class="pix-title" style="color: #ff5df6; display: flex; align-items: center; justify-content: space-between; font-size: 13px;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <Keyboard size={14} /> {m.keymapSettings()}
              </div>
              <button class="pix-btn text" onclick={resetAllToDefault} style="padding: 2px 6px; font-size: 10px; color: #ff5555; border-color: rgba(255,85,85,0.3); background: transparent;">
                <RotateCcw size={10} style="margin-right: 2px; display: inline-block;" /> {m.toastResetAll()}
              </button>
            </div>
            <Divider {...ui} />

            <div style="background: rgba(255, 93, 246, 0.05); border: 1.5px dashed rgba(255, 93, 246, 0.3); padding: 10px; border-radius: 4px; margin-bottom: 12px; font-size: 11px; line-height: 1.4;">
              <div style="font-weight: bold; color: #ff5df6; display: flex; align-items: center; gap: 4px; margin-bottom: 4px;">
                <Info size={11} /> {m.keymapGuideTitle()}
              </div>
              <ul style="margin: 0; padding-left: 16px; color: var(--pix-dim);">
                <li>{m.keymapGuideStep1()}</li>
                <li>{@html m.keymapGuideStep2().replace('Ctrl', '<code style="background: #222; padding: 1px 4px; border-radius: 2px; font-family: monospace;">Ctrl</code>').replace('Alt', '<code style="background: #222; padding: 1px 4px; border-radius: 2px; font-family: monospace;">Alt</code>').replace('Shift', '<code style="background: #222; padding: 1px 4px; border-radius: 2px; font-family: monospace;">Shift</code>').replace('Command', '<code style="background: #222; padding: 1px 4px; border-radius: 2px; font-family: monospace;">Command</code>').replace('Mod', '<code style="background: #222; padding: 1px 4px; border-radius: 2px; font-family: monospace;">Mod</code>')}</li>
                <li>{m.keymapGuideStep3()}</li>
                <li>{m.keymapGuideStep4()}</li>
              </ul>
            </div>

            <!-- Grouping shortcuts by category -->
            <div style="display: flex; flex-direction: column; gap: 16px;">
              {#each ['view', 'edit', 'tools'] as cat}
                <div>
                  <div style="margin-bottom: 8px; font-weight: bold; font-size: 11px; color: #ff5df6; text-transform: uppercase; letter-spacing: 0.5px; border-left: 3px solid #ff5df6; padding-left: 6px; display: flex; align-items: center; gap: 4px;">
                    {cat === 'view' ? m.catView() : cat === 'edit' ? m.catEdit() : m.catTools()}
                  </div>

                  <div style="display: flex; flex-direction: column; gap: 6px;">
                    {#each shortcuts.filter(s => s.category === cat) as s}
                      {@const isRecording = recordingId === s.id}
                      <!-- Check for conflict -->
                      {@const conflict = s.key !== 'None' && shortcuts.find(other => other.id !== s.id && other.key === s.key)}
                      
                      <div class="shortcut-row" style="display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; background: rgba(255,255,255,0.02); border: 1.5px solid rgba(255,255,255,0.05); border-radius: 4px; font-size: 11px; transition: all 0.1s ease;">
                        <div style="flex: 1; min-width: 0; padding-right: 12px;">
                          <div style="font-weight: bold; color: #fff; display: flex; align-items: center; gap: 6px;">
                            {s.name}
                            {#if conflict}
                              <span style="font-size: 9px; color: #ff5555; background: rgba(255,85,85,0.15); padding: 1px 6px; border: 1.5px solid rgba(255,85,85,0.3); border-radius: 3px;">
                                {m.keymapConflict({ name: conflict.name })}
                              </span>
                            {/if}
                          </div>
                          <div class="pix-dim" style="font-size: 10px; margin-top: 2px;">{s.description}</div>
                        </div>

                        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                          <!-- Shortcut Key Badge -->
                          {#if isRecording}
                            <button class="pix-btn" style="min-width: 120px; font-family: monospace; font-size: 10px; border-color: #ff5df6; background: rgba(255, 93, 246, 0.15); text-align: center;" onclick={() => recordingId = null}>
                              {m.recordingPrompt()}
                            </button>
                          {:else}
                            <span style="display: inline-block; min-width: 70px; text-align: center; font-family: monospace; font-weight: bold; background: #000; color: {s.key === 'None' ? '#666' : '#ff5df6'}; border: 1.5px solid {s.key === 'None' ? '#333' : 'rgba(255, 93, 246, 0.4)'}; padding: 3px 8px; border-radius: 3px; font-size: 11px;">
                              {s.key}
                            </span>
                          {/if}

                          <!-- Quick Actions -->
                          <div style="display: flex; gap: 4px;">
                            {#if isRecording}
                              <button class="pix-btn text" style="color: #ff5555; border-color: rgba(255,85,85,0.3); font-size: 10px; padding: 2px 6px; background: transparent;" onclick={() => recordingId = null}>
                                {m.cancel()}
                              </button>
                            {:else}
                              <button class="pix-btn" style="font-size: 10px; padding: 3px 8px;" onclick={() => startRecording(s.id)}>
                                {m.recordBtn()}
                              </button>
                              {#if s.key !== 'None'}
                                <button class="pix-btn text" style="font-size: 10px; padding: 3px 6px; color: var(--pix-dim); border-color: rgba(255,255,255,0.1); background: transparent;" onclick={() => clearShortcut(s.id)}>
                                  {m.clearBtn()}
                                </button>
                              {/if}
                              {#if s.key !== s.defaultKey}
                                <button class="pix-btn text" style="font-size: 10px; padding: 3px 6px; color: var(--pix-cyan); border-color: rgba(76,214,255,0.15); background: transparent;" onclick={() => resetToDefault(s.id)}>
                                  {m.defaultBtn()}
                                </button>
                              {/if}
                            {/if}
                          </div>
                        </div>
                      </div>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          {/snippet}
        </Card>
      {/if}
    </div>
  </div>
</div>

<style>
  .pix-sidebar-btn {
    background: rgba(0, 0, 0, 0.3);
    border: 2px solid var(--pix-border, #444);
    color: var(--pix-dim, #aaa);
    padding: 10px 14px;
    font-size: 11px;
    font-family: var(--pix-font);
    text-align: left;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    transition: all 0.15s ease;
    image-rendering: pixelated;
    border-radius: 4px;
  }
  .pix-sidebar-btn:hover {
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    border-color: var(--pix-border-hover, #666);
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
</style>