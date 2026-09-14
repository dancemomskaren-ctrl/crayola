import { createSignal, For, Show, onMount, onCleanup } from "solid-js";

const API = "/api";

interface Project {
  id: string;
  name: string;
  type: string;
  status: string;
  script?: string;
  url?: string;
  clientId?: string | null;
  createdAt: number;
}

interface Render {
  id: string;
  projectId: string;
  status: string;
  outputPath?: string;
  error?: string;
  settings?: string;
  createdAt: number;
}

interface Voice {
  id: string;
  name: string;
  gender: string;
  style: string;
}

interface Template {
  id: string;
  name: string;
  desc: string;
  category: string;
  icon: string;
  defaults: Record<string, any>;
  fields: {
    key: string;
    label: string;
    type: string;
    placeholder?: string;
    options?: { value: string; label: string }[];
    default?: any;
  }[];
}

interface Msg {
  sender: string;
  text: string;
  isMe: boolean;
}

interface CaptionEntry {
  text: string;
  startMs: number;
  endMs: number;
}

export default function App() {
  // Tab navigation
  const [activeTab, setActiveTab] = createSignal<"create" | "projects" | "clients">("create");
  
  const [projects, setProjects] = createSignal<Project[]>([]);
  const [templates, setTemplates] = useSignal<Template[]>([]);
  const [selectedTpl, setSelectedTpl] = useSignal<Template | null>(null);
  const [tplFields, setTplFields] = useSignal<
    Record<string, string | number | boolean>
  >({});
  const [name, setName] = useSignal("");
  const [creating, setCreating] = useSignal(false);
  const [activeRender, setActiveRender] = useSignal<Render | null>(null);
  const [error, setError] = useSignal("");
  const [voices, setVoices] = useSignal<Voice[]>([]);

  // Fake text specific
  const [messages, setMessages] = createSignal<Msg[]>([]);
  const [senderName, setSenderName] = useSignal("Contact");

  // Custom captions
  const [captionMode, setCaptionMode] = useSignal<"auto" | "custom">("auto");
  const [customCaptions, setCustomCaptions] = useSignal<CaptionEntry[]>([]);

  // Media library
  const [stocks, setStocks] = useSignal<{ name: string; size: number }[]>([]);
  const [music, setMusic] = useSignal<{ name: string; size: number }[]>([]);

  // Project history
  const [expandedProject, setExpandedProject] = createSignal<string | null>(
    null,
  );
  const [projectRenders, setProjectRenders] = useSignal<
    Record<string, Render[]>
  >({});

  // Analytics
  const [analyticsData, setAnalyticsData] = useSignal<{
    total: {
      views: number;
      likes: number;
      comments: number;
      shares: number;
      saves: number;
    };
    byPlatform: Record<string, { views: number; posts: number }>;
    postCount: number;
  } | null>(null);
  const [postQueue, setPostQueue] = useSignal<any[]>([]);

  // Clients
  interface Client {
    id: string;
    name: string;
    notes?: string | null;
    createdAt: number;
  }
  const [clients, setClients] = useSignal<Client[]>([]);
  const [newClientName, setNewClientName] = useSignal("");
  const [newClientNotes, setNewClientNotes] = useSignal("");
  const [clientLoading, setClientLoading] = useSignal(false);
  const [deliveringClientId, setDeliveringClientId] = useSignal<string | null>(null);
  const [selectedProjectClientId, setSelectedProjectClientId] = useSignal<string>("");

  async function loadClients() {
    try {
      const res = await fetch(`${API}/clients`);
      if (res.ok) setClients(await res.json());
    } catch {}
  }

  async function createClient() {
    if (!newClientName().trim()) {
      toast("Enter a client name first", "err");
      return;
    }
    setClientLoading(true);
    try {
      const res = await fetch(`${API}/clients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newClientName().trim(),
          notes: newClientNotes().trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create client");
      }
      setNewClientName("");
      setNewClientNotes("");
      toast("Client added", "ok");
      await loadClients();
    } catch (err: any) {
      toast(err.message, "err");
    } finally {
      setClientLoading(false);
    }
  }

  async function deleteClient(id: string) {
    if (!confirm("Remove this client? Their projects will stay, just unassigned.")) return;
    try {
      await fetch(`${API}/clients/${id}`, { method: "DELETE" });
      setClients(clients().filter((c) => c.id !== id));
      toast("Client removed", "ok");
    } catch {
      toast("Failed to remove client", "err");
    }
  }

  async function deliverForClient(id: string, name: string) {
    setDeliveringClientId(id);
    try {
      const res = await fetch(`${API}/deliver/${id}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delivery failed");
      if (data.delivered === 0) {
        toast(data.message || "Nothing new to deliver", "info");
      } else {
        toast(`Delivered ${data.delivered} clip(s) for ${name}`, "ok");
      }
    } catch (err: any) {
      toast(err.message, "err");
    } finally {
      setDeliveringClientId(null);
    }
  }

  // Auto clip results
  const [autoClips, setAutoClips] = useSignal<any[]>([]);
  const [autoClipLoading, setAutoClipLoading] = useSignal(false);

  // Auto clip: local mp4 upload (alternative to pasting a URL)
  const [uploadFile, setUploadFile] = useSignal<File | null>(null);
  const [uploadedPath, setUploadedPath] = useSignal<string>("");
  const [uploading, setUploading] = useSignal(false);

  async function uploadLocalFile(file: File) {
    setUploadFile(file);
    setUploadedPath("");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API}/upload`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }
      const data = await res.json();
      setUploadedPath(data.path);
      toast(`Uploaded ${file.name}`, "ok");
    } catch (err: any) {
      toast(err.message, "err");
      setUploadFile(null);
    } finally {
      setUploading(false);
    }
  }

  // Toasts
  const [toasts, setToasts] = createSignal<
    { id: number; msg: string; type: "ok" | "err" | "info" }[]
  >([]);
  let toastId = 0;

  // Script writer
  const [scriptTopic, setScriptTopic] = createSignal("");
  const [scriptStyle, setScriptStyle] = createSignal<string>("motivational");
  const [scriptDuration, setScriptDuration] = createSignal(30);
  // Opt-in only — defaults to false every session, never auto-enabled.
  const [ragebaitHook, setRagebaitHook] = createSignal(false);
  const [scriptLoading, setScriptLoading] = createSignal(false);
  const [generatedScript, setGeneratedScript] = createSignal<{
    hook: string;
    script: string;
    callToAction: string;
    hashtags: string[];
  } | null>(null);
  function toast(msg: string, type: "ok" | "err" | "info" = "ok") {
    const id = ++toastId;
    setToasts([...toasts(), { id, msg, type }]);
    setTimeout(() => setToasts(toasts().filter((t) => t.id !== id)), 4000);
  }

  // ─── Script Generation ───
  async function generateScript() {
    if (!scriptTopic().trim()) {
      toast("Enter a topic first", "err");
      return;
    }
    setScriptLoading(true);
    try {
      const res = await fetch(`${API}/generate-script`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: scriptTopic(),
          style: scriptStyle(),
          duration: scriptDuration(),
          ragebaitHook: ragebaitHook(),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Script generation failed");
      }
      const data = await res.json();
      setGeneratedScript(data);
      toast("Script generated!", "ok");
    } catch (err: any) {
      toast(err.message, "err");
    } finally {
      setScriptLoading(false);
    }
  }

  function applyScriptToTemplate() {
    const script = generatedScript();
    if (!script) return;
    const fullText = `${script.hook}\n\n${script.script}\n\n${script.callToAction}`;
    updateField("script", fullText);
    toast("Script applied to template", "ok");
  }

  // ─── Hook Scoring ───
  const [hookScore, setHookScore] = createSignal<{
    score: number;
    grade: string;
    suggestions: string[];
  } | null>(null);
  const [hookScoreLoading, setHookScoreLoading] = createSignal(false);

  async function scoreCurrentHook() {
    const script = generatedScript();
    if (!script?.hook) {
      toast("Generate a script first", "err");
      return;
    }
    setHookScoreLoading(true);
    try {
      const res = await fetch(`${API}/score-hook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hook: script.hook }),
      });
      if (!res.ok) throw new Error("Scoring failed");
      setHookScore(await res.json());
    } catch (err: any) {
      toast(err.message, "err");
    } finally {
      setHookScoreLoading(false);
    }
  }

  // ─── Variations ───
  const [variations, setVariations] = createSignal<any[]>([]);
  const [variationsLoading, setVariationsLoading] = createSignal(false);

  async function generateVariations() {
    if (!scriptTopic().trim()) {
      toast("Enter a topic first", "err");
      return;
    }
    setVariationsLoading(true);
    try {
      const res = await fetch(`${API}/generate-variations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: scriptTopic(),
          style: scriptStyle(),
          count: 5,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Variation generation failed");
      }
      const data = await res.json();
      setVariations(data.variations ?? []);
      toast(`${data.variations?.length ?? 0} variations generated!`, "ok");
    } catch (err: any) {
      toast(err.message, "err");
    } finally {
      setVariationsLoading(false);
    }
  }

  function applyVariation(v: any) {
    setGeneratedScript({
      hook: v.hook,
      script: v.script,
      callToAction: v.callToAction,
      hashtags: v.hashtags,
    });
    setHookScore(null);
    toast("Variation applied — score it or render!", "ok");
  }

  // Batch processing
  const [batchId, setBatchId] = useSignal<string | null>(null);
  const [batchStatus, setBatchStatus] = useSignal<{
    totalClips: number;
    completedClips: number;
    status: string;
  } | null>(null);
  let batchPollId: ReturnType<typeof setInterval> | null = null;

  let pollId: ReturnType<typeof setInterval> | null = null;

  onMount(async () => {
    const [
      projRes,
      tplRes,
      voiceRes,
      stockRes,
      musicRes,
      analyticsRes,
      queueRes,
    ] = await Promise.all([
      fetch(`${API}/projects`),
      fetch(`${API}/templates`),
      fetch(`${API}/voices`),
      fetch(`${API}/stocks`),
      fetch(`${API}/music`),
      fetch(`${API}/analytics/summary`),
      fetch(`${API}/post-queue`),
    ]);
    if (projRes.ok) setProjects(await projRes.json());
    if (tplRes.ok) setTemplates(await tplRes.json());
    if (voiceRes.ok) setVoices(await voiceRes.json());
    if (stockRes.ok) setStocks(await stockRes.json());
    if (musicRes.ok) setMusic(await musicRes.json());
    if (analyticsRes.ok) setAnalyticsData(await analyticsRes.json());
    if (queueRes.ok) setPostQueue(await queueRes.json());
    loadClients();
  });

  onCleanup(() => {
    if (pollId) clearInterval(pollId);
    if (batchPollId) clearInterval(batchPollId);
  });

  function selectTemplate(tpl: Template) {
    setSelectedTpl(tpl);
    const fields: Record<string, string> = {};
    for (const f of tpl.fields) {
      fields[f.key] = f.default ?? "";
    }
    setTplFields(fields);
    setName(`${tpl.name} - ${new Date().toLocaleDateString()}`);
    setCaptionMode("auto");
    setCustomCaptions([]);

    // Pre-fill messages for fake text template
    if (tpl.id === "fake_text") {
      setMessages([
        { sender: "Them", text: "Hey, are you free tonight?", isMe: false },
        { sender: "Me", text: "Yeah! What's up?", isMe: true },
        { sender: "Them", text: "Want to grab dinner?", isMe: false },
      ]);
    }
  }

  function updateField(key: string, val: string | number | boolean) {
    setTplFields({ ...tplFields(), [key]: val });
  }

  function addMessage(isMe: boolean) {
    setMessages([
      ...messages(),
      { sender: isMe ? "Me" : senderName(), text: "", isMe },
    ]);
  }

  function updateMessage(idx: number, text: string) {
    const copy = [...messages()];
    copy[idx] = { ...copy[idx], text };
    setMessages(copy);
  }

  function removeMessage(idx: number) {
    setMessages(messages().filter((_, i) => i !== idx));
  }

  function addCaption() {
    const last = customCaptions().at(-1);
    const startMs = last ? last.endMs : 0;
    setCustomCaptions([
      ...customCaptions(),
      { text: "", startMs, endMs: startMs + 2000 },
    ]);
  }

  function updateCaption(idx: number, patch: Partial<CaptionEntry>) {
    const copy = [...customCaptions()];
    copy[idx] = { ...copy[idx], ...patch };
    setCustomCaptions(copy);
  }

  function removeCaption(idx: number) {
    setCustomCaptions(customCaptions().filter((_, i) => i !== idx));
  }

  function splitScriptToCaptions() {
    const script = String(tplFields().script ?? "");
    if (!script.trim()) return;
    const words = script.split(/\s+/).filter(Boolean);
    const groups: CaptionEntry[] = [];
    let i = 0;
    let ms = 0;
    while (i < words.length) {
      let chunk = "";
      while (i < words.length && chunk.length + words[i].length < 60) {
        chunk += (chunk ? " " : "") + words[i];
        i++;
      }
      const dur = Math.max(chunk.length * 60, 2000);
      groups.push({ text: chunk, startMs: ms, endMs: ms + dur });
      ms += dur;
    }
    setCustomCaptions(groups);
    setCaptionMode("custom");
  }

  async function create() {
    const tpl = selectedTpl();
    if (!tpl || !name().trim()) return;
    setCreating(true);
    setError("");
    try {
      const fields = tplFields();
      const settings: any = { ...tpl.defaults, ...fields };

      // Handle Reddit URL import
      if (fields.redditUrl) {
        const redditRes = await fetch(`${API}/reddit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: fields.redditUrl }),
        });
        if (redditRes.ok) {
          const data = await redditRes.json();
          settings.script = [data.title, data.selftext]
            .filter(Boolean)
            .join("\n\n");
        }
      }

      // Handle quiz options parsing
      if (fields.options && typeof fields.options === "string") {
        settings.options = fields.options
          .split(",")
          .map((o: string) => o.trim());
      }

      // Handle fake text messages
      if (tpl.id === "fake_text") {
        settings.messages = messages().filter((m) => m.text.trim());
        settings.senderName = senderName();
      }

      // Handle custom captions
      if (captionMode() === "custom" && customCaptions().length > 0) {
        settings.customCaptions = customCaptions().filter((c) => c.text.trim());
      }

      // Auto clip: call dedicated endpoint
      if (tpl.id === "auto_clip") {
        const localFilePath = uploadedPath();
        if (!fields.url && !localFilePath) {
          throw new Error(
            "Provide a URL or upload an mp4 for auto-clip",
          );
        }
        setAutoClipLoading(true);
        setCreating(false);
        toast("Analyzing video — this may take 30-60s...", "info");
        const acRes = await fetch(`${API}/auto-clip`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: selectedProjectClientId() || undefined,
            // Uploaded file takes priority over a pasted URL, matching
            // the API's precedence rule.
            url: localFilePath ? undefined : fields.url,
            localFilePath: localFilePath || undefined,
            clipCount: settings.clipCount,
            minDuration: settings.minDuration,
            maxDuration: settings.maxDuration,
            language: settings.language,
          }),
        });
        setAutoClipLoading(false);
        if (!acRes.ok) {
          const err = await acRes.json();
          throw new Error(err.error || "Auto-clip failed");
        }
        const acData = await acRes.json();
        setAutoClips(acData.clips);
        toast(`Found ${acData.clips.length} highlight clips`, "ok");
        // Refresh project list
        const pRes = await fetch(`${API}/projects`);
        if (pRes.ok) setProjects(await pRes.json());
        return;
      }

      // Standup Comedy: comedy-optimized clipping (laugh extension, smart zoom, TikTok captions)
      if (tpl.id === "standup_comedy") {
        const localFilePath = uploadedPath();
        if (!fields.url && !localFilePath) {
          throw new Error(
            "Provide a URL or upload an mp4 for standup clipping",
          );
        }
        setAutoClipLoading(true);
        setCreating(false);
        toast("Analyzing comedy special — this may take 1-2 mins...", "info");
        const scRes = await fetch(`${API}/standup-clip`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // Uploaded file takes priority over a pasted URL
            url: localFilePath ? undefined : fields.url,
            localFilePath: localFilePath || undefined,
            clipCount: settings.clipCount ?? 5,
            minDuration: settings.minDuration ?? 30,
            maxDuration: settings.maxDuration ?? 90,
            language: settings.language,
            captionStyle: settings.captionStyle ?? "bold_pop",
            platform: fields.platform ?? "9:16",
            quality: fields.quality ?? "standard",
            clientId: selectedProjectClientId() || undefined,
            extendForLaughter: settings.extendForLaughter ?? true,
            zoomOnLaughter: settings.zoomOnLaughter ?? true,
          }),
        });
        setAutoClipLoading(false);
        if (!scRes.ok) {
          const err = await scRes.json();
          throw new Error(err.error || "Standup clip failed");
        }
        const scData = await scRes.json();
        setAutoClips(scData.clips.map((c: any) => ({ ...c, template: "standup" })));
        toast(`Found ${scData.clips.length} comedy highlight clips`, "ok");
        const pRes2 = await fetch(`${API}/projects`);
        if (pRes2.ok) setProjects(await pRes2.json());
        return;
      }

      // Sermon clip: call batch endpoint for progress tracking
      if (tpl.id === "sermon_clip") {
        if (!fields.url) {
          throw new Error("URL is required for sermon clip");
        }
        setCreating(false);
        toast("Starting sermon clip batch...", "info");
        const scRes = await fetch(`${API}/batch-clip`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: selectedProjectClientId() || undefined,
            url: fields.url,
            templateId: "sermon_clip",
            clipCount: settings.clipCount,
            minDuration: settings.minDuration,
            maxDuration: settings.maxDuration,
            language: settings.language,
            platform: settings.platform,
            quality: settings.quality,
            captionStyle: settings.captionStyle,
            scriptureReference: fields.scriptureReference || settings.scriptureReference,
            transition: settings.transition,
            smartZoom: settings.smartZoom,
            hookIntro: settings.hookIntro,
            voiceVolume: settings.voiceVolume,
            musicVolume: settings.musicVolume,
            bgVideo: settings.bgVideo,
            bgMusic: settings.bgMusic,
            silenceRemoval: settings.silenceRemoval,
          }),
        });
        if (!scRes.ok) {
          const err = await scRes.json();
          throw new Error(err.error || "Failed to start batch");
        }
        const scData = await scRes.json();
        setBatchId(scData.batchId);
        pollBatch(scData.batchId);
        return;
      }

      // Podcast clip: call batch endpoint
      if (tpl.id === "podcast_clip") {
        if (!fields.url) {
          throw new Error("URL is required for podcast clip");
        }
        setCreating(false);
        toast("Starting podcast clip batch...", "info");
        const pcRes = await fetch(`${API}/batch-clip`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: selectedProjectClientId() || undefined,
            url: fields.url,
            templateId: "podcast_clip",
            clipCount: settings.clipCount,
            minDuration: settings.minDuration,
            maxDuration: settings.maxDuration,
            language: settings.language,
            platform: settings.platform,
            quality: settings.quality,
            captionStyle: settings.captionStyle,
            transition: settings.transition,
            smartZoom: settings.smartZoom,
            voiceVolume: settings.voiceVolume,
            musicVolume: settings.musicVolume,
            bgVideo: settings.bgVideo,
            bgMusic: settings.bgMusic,
            silenceRemoval: settings.silenceRemoval,
          }),
        });
        if (!pcRes.ok) {
          const err = await pcRes.json();
          throw new Error(err.error || "Failed to start batch");
        }
        const pcData = await pcRes.json();
        setBatchId(pcData.batchId);
        pollBatch(pcData.batchId);
        return;
      }

      // Reaction: call dedicated endpoint
      if (tpl.id === "reaction") {
        if (!fields.mainUrl) {
          throw new Error("Main video URL is required");
        }
        if (!fields.reactionUrl) {
          throw new Error("Reaction video URL is required");
        }
        setAutoClipLoading(true);
        setCreating(false);
        toast("Compositing reaction video...", "info");
        const rxRes = await fetch(`${API}/reaction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mainUrl: fields.mainUrl,
            reactionUrl: fields.reactionUrl,
            pipPosition: settings.pipPosition,
            pipSize: settings.pipSize,
            platform: settings.platform,
            quality: settings.quality,
          }),
        });
        setAutoClipLoading(false);
        if (!rxRes.ok) {
          const err = await rxRes.json();
          throw new Error(err.error || "Reaction failed");
        }
        const rxData = await rxRes.json();
        setActiveRender({
          id: rxData.renderId,
          projectId: rxData.projectId,
          status: "done",
          outputPath: "",
          createdAt: Date.now(),
        });
        toast("Reaction video ready!", "ok");
        const pRes4 = await fetch(`${API}/projects`);
        if (pRes4.ok) setProjects(await pRes4.json());
        return;
      }

      // Top list: call dedicated endpoint
      if (tpl.id === "top_list") {
        const listItems = String(settings.items ?? "")
          .split("\n")
          .map((s: string) => s.trim())
          .filter(Boolean);
        if (listItems.length === 0) {
          throw new Error("Add at least one list item");
        }
        setAutoClipLoading(true);
        setCreating(false);
        toast("Generating countdown video...", "info");
        const tlRes = await fetch(`${API}/top-list`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: settings.title ?? "Top List",
            items: listItems,
            revealDuration: settings.revealDuration,
            platform: settings.platform,
            quality: settings.quality,
            captionStyle: settings.captionStyle,
            voice: settings.voice,
            voiceVolume: settings.voiceVolume,
            musicVolume: settings.musicVolume,
            bgVideo: settings.bgVideo,
            bgMusic: settings.bgMusic,
          }),
        });
        setAutoClipLoading(false);
        if (!tlRes.ok) {
          const err = await tlRes.json();
          throw new Error(err.error || "Top list failed");
        }
        const tlData = await tlRes.json();
        setActiveRender({
          id: tlData.renderId,
          projectId: tlData.projectId,
          status: "done",
          outputPath: "",
          createdAt: Date.now(),
        });
        toast("Countdown video ready!", "ok");
        const pRes5 = await fetch(`${API}/projects`);
        if (pRes5.ok) setProjects(await pRes5.json());
        return;
      }

      const res = await fetch(`${API}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name(),
          type: tpl.defaults.type ?? tpl.id,
          script: settings.script,
          url: settings.url,
          clientId: selectedProjectClientId() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create project");
      }
      const { id } = await res.json();

      const rRes = await fetch(`${API}/renders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id, settings }),
      });
      if (!rRes.ok) {
        const err = await rRes.json();
        throw new Error(err.error || "Failed to start render");
      }
      const renderData = await rRes.json();
      setActiveRender({ ...renderData, projectId: id, status: "processing" });
      pollRender(renderData.id);

      const pRes = await fetch(`${API}/projects`);
      setProjects(await pRes.json());
      setSelectedTpl(null);
      setTplFields({});
      setName("");
    } catch (err: any) {
      setError(err.message);
      toast(err.message, "err");
    } finally {
      setCreating(false);
    }
  }

  function pollRender(id: string) {
    if (pollId) clearInterval(pollId);
    let failures = 0;
    pollId = setInterval(async () => {
      try {
        const res = await fetch(`${API}/renders/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: Render = await res.json();
        failures = 0;
        setActiveRender(data);
        if (data.status === "done" || data.status === "error") {
          clearInterval(pollId!);
          pollId = null;
          if (data.status === "done") toast("Render complete!", "ok");
          if (data.status === "error") toast("Render failed", "err");
        }
      } catch {
        failures++;
        if (failures >= 5) {
          clearInterval(pollId!);
          pollId = null;
          setError("Lost connection to server");
        }
      }
    }, 2000);
  }

  function pollBatch(id: string) {
    if (batchPollId) clearInterval(batchPollId);
    let failures = 0;
    batchPollId = setInterval(async () => {
      try {
        const res = await fetch(`${API}/batch/${id}/status`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        failures = 0;
        setBatchStatus({
          totalClips: data.totalClips,
          completedClips: data.completedClips,
          status: data.status,
        });
        if (data.status === "done") {
          clearInterval(batchPollId!);
          batchPollId = null;
          setAutoClips(data.clips ?? []);
          setBatchId(null);
          setBatchStatus(null);
          toast(
            `Batch complete — ${data.clips?.length ?? 0} clips ready`,
            "ok",
          );
          const pRes = await fetch(`${API}/projects`);
          if (pRes.ok) setProjects(await pRes.json());
        }
        if (data.status === "error") {
          clearInterval(batchPollId!);
          batchPollId = null;
          setBatchId(null);
          setBatchStatus(null);
          toast(data.error || "Batch failed", "err");
        }
      } catch {
        failures++;
        if (failures >= 5) {
          clearInterval(batchPollId!);
          batchPollId = null;
          setBatchId(null);
          setBatchStatus(null);
          toast("Lost connection to batch processor", "err");
        }
      }
    }, 2000);
  }

  async function deleteProject(id: string) {
    if (!confirm("Delete this project and all its renders?")) return;
    try {
      await fetch(`${API}/projects/${id}`, { method: "DELETE" });
      setProjects(projects().filter((p) => p.id !== id));
      toast("Project deleted", "ok");
    } catch {}
  }

  async function toggleProject(id: string) {
    if (expandedProject() === id) {
      setExpandedProject(null);
      return;
    }
    setExpandedProject(id);
    if (!projectRenders()[id]) {
      try {
        const res = await fetch(`${API}/projects/${id}/renders`);
        if (res.ok) {
          const data = await res.json();
          setProjectRenders({ ...projectRenders(), [id]: data });
        }
      } catch {}
    }
  }

  async function deleteRender(projectId: string, renderId: string) {
    try {
      await fetch(`${API}/renders/${renderId}`, { method: "DELETE" });
      const renders = projectRenders()[projectId] ?? [];
      setProjectRenders({
        ...projectRenders(),
        [projectId]: renders.filter((r) => r.id !== renderId),
      });
      toast("Render deleted", "ok");
    } catch {}
  }

  function formatDate(ts: number) {
    return new Date(ts).toLocaleString();
  }

  async function deleteStock(name: string) {
    try {
      const res = await fetch(`${API}/stocks/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setStocks(stocks().filter((s) => s.name !== name));
        toast("Clip removed", "ok");
      }
    } catch {}
  }

  async function deleteMusic(name: string) {
    try {
      const res = await fetch(`${API}/music/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMusic(music().filter((m) => m.name !== name));
        toast("Track removed", "ok");
      }
    } catch {}
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  return (
    <div class="min-h-screen bg-zinc-950 text-white">
      {/* Toast notifications */}
      <div class="fixed top-4 right-4 z-50 space-y-2">
        <For each={toasts()}>
          {(t) => (
            <div
              class={`px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg transition-all duration-300 animate-[slideIn_0.2s_ease] ${
                t.type === "ok"
                  ? "bg-green-600 text-white"
                  : t.type === "err"
                    ? "bg-red-600 text-white"
                    : "bg-zinc-700 text-zinc-200"
              }`}
            >
              {t.msg}
            </div>
          )}
        </For>
      </div>

      <header class="border-b border-zinc-800 px-6 py-4">
        <h1 class="text-2xl font-bold">
          <span class="text-brand">Crayo</span> Local
        </h1>
        <p class="text-sm text-zinc-400 mt-1">AI short-form video generator</p>
        <nav class="flex gap-1 mt-4">
          <For each={[
            { id: "create" as const, label: "Create" },
            { id: "projects" as const, label: "Projects" },
            { id: "clients" as const, label: "Clients" },
          ]}>
            {(tab) => (
              <button
                onClick={() => setActiveTab(tab.id)}
                class={`px-4 py-2 text-sm font-medium rounded-lg transition ${
                  activeTab() === tab.id
                    ? "bg-brand text-white"
                    : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                }`}
              >
                {tab.label}
              </button>
            )}
          </For>
        </nav>
      </header>

      <main class="max-w-5xl mx-auto px-6 py-8">
        {/* ═══ Clients Tab ═══ */}
        <Show when={activeTab() === "clients"}>
          <div class="bg-zinc-900 rounded-xl p-6 border border-zinc-800 mb-8">
            <h2 class="text-lg font-semibold mb-4">🏛️ Clients</h2>

            {/* Add client form */}
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
              <input
                type="text"
                value={newClientName()}
                onInput={(e) => setNewClientName(e.currentTarget.value)}
                placeholder="Client name (e.g. Grace Community Church)"
                class="md:col-span-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-brand"
              />
              <input
                type="text"
                value={newClientNotes()}
                onInput={(e) => setNewClientNotes(e.currentTarget.value)}
                placeholder="Notes (contact, contract terms, etc.) — optional"
                class="md:col-span-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-brand"
              />
              <button
                onClick={createClient}
                disabled={clientLoading() || !newClientName().trim()}
                class="bg-brand hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-lg transition"
              >
                {clientLoading() ? "Adding..." : "+ Add Client"}
              </button>
            </div>

            {/* Client list */}
            <Show
              when={clients().length > 0}
              fallback={
                <p class="text-sm text-zinc-500">
                  No clients yet. Add your first church or account above.
                </p>
              }
            >
              <div class="space-y-3">
                <For each={clients()}>
                  {(cl) => {
                    const clientProjectCount = () =>
                      projects().filter((p: any) => p.clientId === cl.id).length;
                    return (
                      <div class="bg-zinc-800 rounded-lg p-4 border border-zinc-700 flex items-center justify-between gap-4">
                        <div class="flex-1 min-w-0">
                          <div class="font-medium text-white">{cl.name}</div>
                          <Show when={cl.notes}>
                            <div class="text-xs text-zinc-500 mt-0.5 truncate">
                              {cl.notes}
                            </div>
                          </Show>
                          <div class="text-xs text-zinc-500 mt-1">
                            {clientProjectCount()} project{clientProjectCount() === 1 ? "" : "s"}
                          </div>
                        </div>
                        <div class="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => deliverForClient(cl.id, cl.name)}
                            disabled={deliveringClientId() === cl.id}
                            class="text-sm bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition"
                            title="Copy all finished, undelivered clips for this client into a labeled delivery folder"
                          >
                            {deliveringClientId() === cl.id ? "Delivering..." : "📦 Deliver Clips"}
                          </button>
                          <button
                            onClick={() => deleteClient(cl.id)}
                            class="text-sm text-zinc-500 hover:text-red-400 px-2 py-1.5 rounded-lg transition"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>
          </div>
        </Show>

        {/* ═══ Create Tab ═══ */}
        <Show when={activeTab() === "create"}>
        {/* Script Writer */}
        <Show when={!selectedTpl()}>
          <div class="bg-zinc-900 rounded-xl p-6 border border-zinc-800 mb-8">
            <h2 class="text-lg font-semibold mb-4">✍️ AI Script Writer</h2>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div class="md:col-span-2">
                <label class="block text-sm text-zinc-400 mb-1">Topic</label>
                <input
                  type="text"
                  value={scriptTopic()}
                  onInput={(e) => setScriptTopic(e.currentTarget.value)}
                  placeholder="e.g. Why prayer changes everything, How to start a business, The truth about..."
                  class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-brand"
                />
              </div>
              <div>
                <label class="block text-sm text-zinc-400 mb-1">Style</label>
                <select
                  value={scriptStyle()}
                  onChange={(e) => setScriptStyle(e.currentTarget.value)}
                  class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-brand"
                >
                  <option value="church">Church / Sermon</option>
                  <option value="motivational">Motivational</option>
                  <option value="story">Storytelling</option>
                  <option value="educational">Educational</option>
                  <option value="entertainment">Entertainment</option>
                  <option value="news">News / Commentary</option>
                </select>
              </div>
            </div>
            <div class="flex items-center gap-4 mb-4">
              <div class="flex-1">
                <label class="block text-sm text-zinc-400 mb-1">
                  Duration: {scriptDuration()}s
                </label>
                <input
                  type="range"
                  min={15}
                  max={60}
                  step={5}
                  value={scriptDuration()}
                  onInput={(e) =>
                    setScriptDuration(parseInt(e.currentTarget.value))
                  }
                  class="w-full accent-brand"
                />
              </div>
              <label
                class="flex items-center gap-2 text-sm text-zinc-300 select-none"
                title="Off by default. Writes a curiosity-gap hook (implication, unanswered question) instead of a flat statement. Still bound by the same no-false-claims rules as every other style."
              >
                <input
                  type="checkbox"
                  checked={ragebaitHook()}
                  onChange={(e) => setRagebaitHook(e.currentTarget.checked)}
                  class="accent-brand w-4 h-4"
                />
                Ragebait / curiosity hook (opt-in)
              </label>
              <button
                onClick={generateScript}
                disabled={scriptLoading() || !scriptTopic().trim()}
                class="bg-brand hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-6 py-2.5 rounded-lg transition"
              >
                {scriptLoading() ? "Generating..." : "Generate Script"}
              </button>
            </div>

            {/* Generated Script Preview */}
            <Show when={generatedScript()}>
              <div class="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                <div class="flex items-center justify-between mb-3">
                  <h3 class="text-sm font-medium text-zinc-300">
                    Generated Script
                  </h3>
                  <div class="flex gap-2">
                    <button
                      onClick={scoreCurrentHook}
                      disabled={hookScoreLoading()}
                      class="text-sm bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white px-3 py-1 rounded-lg transition"
                    >
                      {hookScoreLoading() ? "Scoring..." : "Score Hook"}
                    </button>
                    <button
                      onClick={generateVariations}
                      disabled={variationsLoading()}
                      class="text-sm bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white px-3 py-1 rounded-lg transition"
                    >
                      {variationsLoading() ? "Generating..." : "5 Variations"}
                    </button>
                    <button
                      onClick={applyScriptToTemplate}
                      class="text-sm bg-brand hover:bg-red-600 text-white px-3 py-1 rounded-lg transition"
                    >
                      Apply to Template →
                    </button>
                  </div>
                </div>

                {/* Hook Score */}
                <Show when={hookScore()}>
                  <div
                    class={`mb-3 p-3 rounded-lg border ${
                      hookScore()!.grade === "S" || hookScore()!.grade === "A"
                        ? "bg-green-900/30 border-green-700"
                        : hookScore()!.grade === "B"
                          ? "bg-yellow-900/30 border-yellow-700"
                          : "bg-red-900/30 border-red-700"
                    }`}
                  >
                    <div class="flex items-center gap-3 mb-2">
                      <span
                        class={`text-2xl font-bold ${
                          hookScore()!.grade === "S"
                            ? "text-green-400"
                            : hookScore()!.grade === "A"
                              ? "text-green-300"
                              : hookScore()!.grade === "B"
                                ? "text-yellow-400"
                                : "text-red-400"
                        }`}
                      >
                        {hookScore()!.grade}
                      </span>
                      <span class="text-sm text-zinc-300">
                        {hookScore()!.score}/100
                      </span>
                    </div>
                    <Show when={hookScore()!.suggestions.length > 0}>
                      <div class="text-xs text-zinc-400 space-y-1">
                        <For each={hookScore()!.suggestions}>
                          {(s) => <div>• {s}</div>}
                        </For>
                      </div>
                    </Show>
                  </div>
                </Show>

                <div class="space-y-3 text-sm">
                  <div>
                    <span class="text-brand font-medium">Hook: </span>
                    <span class="text-zinc-200">{generatedScript()!.hook}</span>
                  </div>
                  <div>
                    <span class="text-brand font-medium">Script: </span>
                    <span class="text-zinc-200 whitespace-pre-wrap">
                      {generatedScript()!.script}
                    </span>
                  </div>
                  <div>
                    <span class="text-brand font-medium">CTA: </span>
                    <span class="text-zinc-200">
                      {generatedScript()!.callToAction}
                    </span>
                  </div>
                  <div class="flex flex-wrap gap-2 pt-2">
                    <For each={generatedScript()!.hashtags}>
                      {(tag) => (
                        <span class="text-xs bg-zinc-700 text-zinc-300 px-2 py-1 rounded">
                          #{tag}
                        </span>
                      )}
                    </For>
                  </div>
                </div>
              </div>

              {/* Variations */}
              <Show when={variations().length > 0}>
                <div class="mt-4 bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 class="text-sm font-medium text-zinc-300 mb-3">
                    Script Variations ({variations().length})
                  </h3>
                  <div class="space-y-3">
                    <For each={variations()}>
                      {(v, idx) => (
                        <div class="bg-zinc-900 rounded-lg p-3 border border-zinc-700">
                          <div class="flex items-center justify-between mb-2">
                            <span class="text-xs text-zinc-500">
                              #{idx() + 1} — {v.angle}
                            </span>
                            <div class="flex items-center gap-2">
                              <span
                                class={`text-xs font-bold px-2 py-0.5 rounded ${
                                  v.hookScore?.grade === "S" ||
                                  v.hookScore?.grade === "A"
                                    ? "bg-green-900 text-green-300"
                                    : v.hookScore?.grade === "B"
                                      ? "bg-yellow-900 text-yellow-300"
                                      : "bg-red-900 text-red-300"
                                }`}
                              >
                                {v.hookScore?.grade} {v.hookScore?.score}
                              </span>
                              <button
                                onClick={() => applyVariation(v)}
                                class="text-xs bg-brand hover:bg-red-600 text-white px-2 py-0.5 rounded transition"
                              >
                                Use This
                              </button>
                            </div>
                          </div>
                          <div class="text-sm text-zinc-200">
                            <span class="text-brand font-medium">Hook: </span>
                            {v.hook}
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </Show>
          </div>
        </Show>

        {/* Step 1: Template Picker */}
        <Show when={!selectedTpl()}>
          <div class="mb-8">
            <h2 class="text-lg font-semibold mb-4">Choose a Template</h2>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
              <For each={templates()}>
                {(tpl) => (
                  <button
                    onClick={() => selectTemplate(tpl)}
                    class="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-left hover:border-brand hover:bg-zinc-800 transition group"
                  >
                    <div class="text-3xl mb-2">{tpl.icon}</div>
                    <div class="font-medium text-sm group-hover:text-brand transition">
                      {tpl.name}
                    </div>
                    <div class="text-xs text-zinc-500 mt-1">{tpl.desc}</div>
                  </button>
                )}
              </For>
            </div>
          </div>

          {/* Analytics Dashboard */}
          <Show when={analyticsData() && analyticsData()!.postCount > 0}>
            <div class="bg-zinc-900 rounded-xl p-6 border border-zinc-800 mb-8">
              <h2 class="text-lg font-semibold mb-4">📊 Analytics Overview</h2>
              <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                <div class="bg-zinc-800 rounded-lg p-3">
                  <div class="text-2xl font-bold text-white">
                    {analyticsData()!.total.views.toLocaleString()}
                  </div>
                  <div class="text-xs text-zinc-500">Total Views</div>
                </div>
                <div class="bg-zinc-800 rounded-lg p-3">
                  <div class="text-2xl font-bold text-pink-400">
                    {analyticsData()!.total.likes.toLocaleString()}
                  </div>
                  <div class="text-xs text-zinc-500">Likes</div>
                </div>
                <div class="bg-zinc-800 rounded-lg p-3">
                  <div class="text-2xl font-bold text-blue-400">
                    {analyticsData()!.total.comments.toLocaleString()}
                  </div>
                  <div class="text-xs text-zinc-500">Comments</div>
                </div>
                <div class="bg-zinc-800 rounded-lg p-3">
                  <div class="text-2xl font-bold text-green-400">
                    {analyticsData()!.total.shares.toLocaleString()}
                  </div>
                  <div class="text-xs text-zinc-500">Shares</div>
                </div>
                <div class="bg-zinc-800 rounded-lg p-3">
                  <div class="text-2xl font-bold text-yellow-400">
                    {analyticsData()!.total.saves.toLocaleString()}
                  </div>
                  <div class="text-xs text-zinc-500">Saves</div>
                </div>
              </div>
              <Show when={Object.keys(analyticsData()!.byPlatform).length > 0}>
                <div class="text-sm text-zinc-400">
                  <span class="font-medium">By Platform: </span>
                  {Object.entries(analyticsData()!.byPlatform)
                    .map(
                      ([platform, data]) =>
                        `${platform} (${data.views.toLocaleString()} views, ${data.posts} posts)`,
                    )
                    .join(" · ")}
                </div>
              </Show>
            </div>
          </Show>

          {/* Post Queue */}
          <Show when={postQueue().length > 0}>
            <div class="bg-zinc-900 rounded-xl p-6 border border-zinc-800 mb-8">
              <h2 class="text-lg font-semibold mb-4">📤 Post Queue</h2>
              <div class="space-y-2">
                <For each={postQueue()}>
                  {(item) => (
                    <div class="flex items-center justify-between bg-zinc-800 rounded-lg px-4 py-2">
                      <div class="flex items-center gap-3">
                        <span
                          class={`text-xs px-2 py-0.5 rounded ${
                            item.status === "posted"
                              ? "bg-green-900 text-green-300"
                              : item.status === "posting"
                                ? "bg-yellow-900 text-yellow-300"
                                : item.status === "failed"
                                  ? "bg-red-900 text-red-300"
                                  : "bg-zinc-700 text-zinc-300"
                          }`}
                        >
                          {item.status}
                        </span>
                        <span class="text-sm text-zinc-300">
                          {item.platform}
                        </span>
                        <span class="text-xs text-zinc-500">
                          {item.scheduledAt
                            ? new Date(item.scheduledAt).toLocaleString()
                            : "Ready to post"}
                        </span>
                      </div>
                      <Show when={item.postUrl}>
                        <a
                          href={item.postUrl}
                          target="_blank"
                          class="text-xs text-brand hover:underline"
                        >
                          View Post →
                        </a>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </Show>

        {/* Step 2: Template Form */}
        <Show when={selectedTpl()}>
          <div class="bg-zinc-900 rounded-xl p-6 border border-zinc-800 mb-8">
            <div class="flex items-center gap-3 mb-4">
              <button
                onClick={() => setSelectedTpl(null)}
                class="text-zinc-400 hover:text-white text-sm"
              >
                ← Back
              </button>
              <h2 class="text-lg font-semibold">
                {selectedTpl()!.icon} {selectedTpl()!.name}
              </h2>
            </div>

            <div class="mb-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div class="md:col-span-2">
                <label class="block text-sm text-zinc-400 mb-1">
                  Project Name
                </label>
                <input
                  type="text"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  placeholder="My viral video"
                  class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-brand"
                />
              </div>
              <div>
                <label class="block text-sm text-zinc-400 mb-1">
                  Client (optional)
                </label>
                <select
                  value={selectedProjectClientId()}
                  onChange={(e) => setSelectedProjectClientId(e.currentTarget.value)}
                  class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-brand"
                >
                  <option value="">— None —</option>
                  <For each={clients()}>
                    {(cl) => <option value={cl.id}>{cl.name}</option>}
                  </For>
                </select>
              </div>
            </div>

            {/* Dynamic template fields */}
            <For each={selectedTpl()!.fields}>
              {(field) => (
                <div class="mb-4">
                  <label class="block text-sm text-zinc-400 mb-1">
                    {field.label}
                  </label>
                  <Show when={field.type === "text"}>
                    <input
                      type="text"
                      value={String(tplFields()[field.key] ?? "")}
                      onInput={(e) =>
                        updateField(field.key, e.currentTarget.value)
                      }
                      placeholder={field.placeholder}
                      disabled={
                        field.key === "url" && !!uploadedPath()
                      }
                      class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-brand disabled:opacity-40"
                    />
                  </Show>
                  {/* Local mp4 upload — alternative to pasting a URL for Auto Clip & Standup Comedy */}
                  <Show when={(selectedTpl()!.id === "auto_clip" || selectedTpl()!.id === "standup_comedy") && field.key === "url"}>
                    <div class="mt-2 flex items-center gap-3">
                      <span class="text-xs text-zinc-500">or</span>
                      <label class="flex items-center gap-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 cursor-pointer hover:border-brand">
                        <input
                          type="file"
                          accept="video/mp4,.mp4"
                          class="hidden"
                          onChange={(e) => {
                            const f = e.currentTarget.files?.[0];
                            if (f) uploadLocalFile(f);
                          }}
                        />
                        {uploading()
                          ? "Uploading..."
                          : uploadFile()
                            ? uploadFile()!.name
                            : "Upload mp4"}
                      </label>
                      <Show when={uploadedPath()}>
                        <button
                          type="button"
                          class="text-xs text-zinc-400 hover:text-white"
                          onClick={() => {
                            setUploadFile(null);
                            setUploadedPath("");
                          }}
                        >
                          Clear
                        </button>
                      </Show>
                    </div>
                    <Show when={uploadedPath()}>
                      <p class="text-xs text-emerald-400 mt-1">
                        Using uploaded file — URL field ignored
                      </p>
                    </Show>
                  </Show>
                  <Show when={field.type === "textarea"}>
                    <textarea
                      value={String(tplFields()[field.key] ?? "")}
                      onInput={(e) =>
                        updateField(field.key, e.currentTarget.value)
                      }
                      placeholder={field.placeholder}
                      rows={4}
                      class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-brand resize-none"
                    />
                  </Show>
                  <Show when={field.type === "select"}>
                    <select
                      value={String(tplFields()[field.key] ?? "")}
                      onChange={(e) =>
                        updateField(field.key, e.currentTarget.value)
                      }
                      class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-brand"
                    >
                      <For each={field.options}>
                        {(opt) => (
                          <option value={opt.value}>{opt.label}</option>
                        )}
                      </For>
                    </select>
                  </Show>
                  <Show when={field.type === "toggle"}>
                    <button
                      type="button"
                      onClick={() =>
                        updateField(field.key, !tplFields()[field.key])
                      }
                      class={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        tplFields()[field.key]
                          ? "bg-brand border-brand text-white"
                          : "bg-zinc-800 border-zinc-700 text-zinc-400"
                      }`}
                    >
                      {tplFields()[field.key] ? "On" : "Off"}
                    </button>
                  </Show>
                  <Show when={field.type === "slider"}>
                    <div class="flex items-center gap-3">
                      <input
                        type="range"
                        min={(field as any).min ?? 0}
                        max={(field as any).max ?? 1}
                        step={(field as any).step ?? 0.1}
                        value={Number(
                          tplFields()[field.key] ?? (field as any).default ?? 0,
                        )}
                        onInput={(e) =>
                          updateField(
                            field.key,
                            parseFloat(e.currentTarget.value),
                          )
                        }
                        class="flex-1 accent-brand"
                      />
                      <span class="text-sm text-zinc-300 w-12 text-right">
                        {Number(
                          tplFields()[field.key] ?? (field as any).default ?? 0,
                        ).toFixed(2)}
                      </span>
                    </div>
                  </Show>
                </div>
              )}
            </For>

            {/* Fake text message editor */}
            <Show when={selectedTpl()!.id === "fake_text"}>
              <div class="mb-4">
                <div class="flex items-center gap-3 mb-3">
                  <label class="block text-sm text-zinc-400">
                    Conversation
                  </label>
                  <input
                    type="text"
                    value={senderName()}
                    onInput={(e) => setSenderName(e.currentTarget.value)}
                    placeholder="Contact name"
                    class="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-brand w-40"
                  />
                </div>

                <div class="space-y-2 mb-3">
                  <For each={messages()}>
                    {(msg, idx) => (
                      <div
                        class={`flex gap-2 items-start ${msg.isMe ? "flex-row-reverse" : ""}`}
                      >
                        <span
                          class={`text-xs px-2 py-0.5 rounded mt-2 whitespace-nowrap ${msg.isMe ? "bg-blue-600" : "bg-zinc-700"}`}
                        >
                          {msg.isMe ? "Me" : senderName()}
                        </span>
                        <input
                          type="text"
                          value={msg.text}
                          onInput={(e) =>
                            updateMessage(idx(), e.currentTarget.value)
                          }
                          placeholder="Type a message..."
                          class={`flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-brand ${msg.isMe ? "text-right" : ""}`}
                        />
                        <button
                          onClick={() => removeMessage(idx())}
                          class="text-zinc-500 hover:text-red-400 text-sm mt-1 px-1"
                        >
                          x
                        </button>
                      </div>
                    )}
                  </For>
                </div>

                <div class="flex gap-2">
                  <button
                    onClick={() => addMessage(false)}
                    class="text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg px-3 py-1.5 text-zinc-300 transition"
                  >
                    + {senderName()} message
                  </button>
                  <button
                    onClick={() => addMessage(true)}
                    class="text-sm bg-blue-900 hover:bg-blue-800 border border-blue-700 rounded-lg px-3 py-1.5 text-blue-200 transition"
                  >
                    + My message
                  </button>
                </div>
              </div>
            </Show>

            {/* Custom captions editor (story templates only) */}
            <Show
              when={
                selectedTpl()!.defaults.type === "story" &&
                selectedTpl()!.id !== "fake_text"
              }
            >
              <div class="mb-4">
                <div class="flex items-center gap-3 mb-3">
                  <label class="block text-sm text-zinc-400">Captions</label>
                  <button
                    onClick={() =>
                      setCaptionMode(
                        captionMode() === "auto" ? "custom" : "auto",
                      )
                    }
                    class={`text-xs px-3 py-1 rounded-full border transition ${
                      captionMode() === "custom"
                        ? "bg-brand border-red-500 text-white"
                        : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white"
                    }`}
                  >
                    {captionMode() === "custom" ? "Custom Mode" : "Auto (STT)"}
                  </button>
                  <Show when={captionMode() === "auto" && tplFields().script}>
                    <button
                      onClick={splitScriptToCaptions}
                      class="text-xs px-3 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white transition"
                    >
                      Edit as custom
                    </button>
                  </Show>
                </div>

                <Show when={captionMode() === "custom"}>
                  <div class="space-y-2 mb-3">
                    <For each={customCaptions()}>
                      {(cap, idx) => (
                        <div class="flex gap-2 items-start">
                          <input
                            type="text"
                            value={cap.text}
                            onInput={(e) =>
                              updateCaption(idx(), {
                                text: e.currentTarget.value,
                              })
                            }
                            placeholder="Caption text..."
                            class="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-brand"
                          />
                          <input
                            type="number"
                            value={cap.startMs / 1000}
                            onInput={(e) =>
                              updateCaption(idx(), {
                                startMs: Number(e.currentTarget.value) * 1000,
                              })
                            }
                            placeholder="Start"
                            step="0.1"
                            class="w-20 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-brand"
                            title="Start (seconds)"
                          />
                          <input
                            type="number"
                            value={cap.endMs / 1000}
                            onInput={(e) =>
                              updateCaption(idx(), {
                                endMs: Number(e.currentTarget.value) * 1000,
                              })
                            }
                            placeholder="End"
                            step="0.1"
                            class="w-20 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-brand"
                            title="End (seconds)"
                          />
                          <button
                            onClick={() => removeCaption(idx())}
                            class="text-zinc-500 hover:text-red-400 text-sm mt-1 px-1"
                          >
                            x
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                  <button
                    onClick={addCaption}
                    class="text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg px-3 py-1.5 text-zinc-300 transition"
                  >
                    + Add caption
                  </button>
                </Show>
              </div>
            </Show>

            <Show when={error()}>
              <p class="text-red-400 text-sm mb-3">{error()}</p>
            </Show>

            <button
              onClick={create}
              disabled={creating() || autoClipLoading() || !name().trim()}
              class="bg-brand hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-6 py-2.5 rounded-lg transition inline-flex items-center gap-2"
            >
              <Show when={autoClipLoading()}>
                <svg
                  class="animate-spin h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                  />
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Analyzing...
              </Show>
              <Show when={!autoClipLoading()}>
                {creating() ? "Creating..." : "Generate Video"}
              </Show>
            </button>
          </div>
        </Show>

        {/* Batch Progress */}
        <Show when={batchStatus()}>
          <div class="bg-zinc-900 rounded-xl p-6 border border-zinc-800 mb-8">
            <div class="flex items-center justify-between mb-3">
              <h2 class="text-lg font-semibold">Batch Processing</h2>
              <span class="text-sm text-zinc-400">
                {batchStatus()!.completedClips} / {batchStatus()!.totalClips}{" "}
                clips
              </span>
            </div>
            <div class="w-full bg-zinc-800 rounded-full h-3 mb-2">
              <div
                class="bg-brand h-3 rounded-full transition-all duration-500"
                style={{
                  width: `${
                    batchStatus()!.totalClips > 0
                      ? (batchStatus()!.completedClips /
                          batchStatus()!.totalClips) *
                        100
                      : 0
                  }%`,
                }}
              />
            </div>
            <p class="text-xs text-zinc-500">
              Rendering clip {batchStatus()!.completedClips + 1} of{" "}
              {batchStatus()!.totalClips} — this may take a few minutes
            </p>
          </div>
        </Show>

        {/* Auto Clip / Sermon Clip / Podcast Clip Results */}
        <Show when={autoClips().length > 0}>
          <div class="bg-zinc-900 rounded-xl p-6 border border-zinc-800 mb-8">
            <h2 class="text-lg font-semibold mb-3">
              {selectedTpl()?.id === "sermon_clip"
                ? "Sermon Clips"
                : selectedTpl()?.id === "podcast_clip"
                  ? "Podcast Clips"
                  : "Auto-Clip Results"}{" "}
              ({autoClips().length} clips)
            </h2>
            <div class="space-y-3">
              <For each={autoClips()}>
                {(clip) => (
                  <div class="flex items-center gap-4 bg-zinc-800 rounded-lg px-4 py-3">
                    <Show when={selectedTpl()?.id === "sermon_clip"}>
                      <video
                        src={`${API}/renders/${clip.renderId}/download`}
                        class="w-24 h-14 object-cover rounded bg-black shrink-0"
                        preload="metadata"
                        muted
                        onmouseover={(e) =>
                          (e.currentTarget as HTMLVideoElement).play()
                        }
                        onmouseout={(e) => {
                          const v = e.currentTarget as HTMLVideoElement;
                          v.pause();
                          v.currentTime = 0;
                        }}
                      />
                    </Show>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <p class="text-sm text-white font-medium truncate">
                          {clip.text}
                        </p>
                        <Show
                          when={
                            selectedTpl()?.id === "sermon_clip" ||
                            selectedTpl()?.id === "podcast_clip"
                          }
                        >
                          <span class="text-[10px] px-1.5 py-0.5 rounded bg-green-900 text-green-300 shrink-0">
                            rendered
                          </span>
                        </Show>
                      </div>
                      <p class="text-xs text-zinc-400 mt-1">
                        {Math.round(clip.startMs / 1000)}s –{" "}
                        {Math.round(clip.endMs / 1000)}s{" · "}Score:{" "}
                        {clip.score.toFixed(1)}
                      </p>
                    </div>
                    <a
                      href={`${API}/renders/${clip.renderId}/download`}
                      class="bg-brand hover:bg-red-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition shrink-0"
                      download={`clip-${clip.renderId.slice(0, 8)}.mp4`}
                    >
                      Download
                    </a>
                  </div>
                )}
              </For>
            </div>
            <button
              onClick={() => setAutoClips([])}
              class="mt-4 text-xs text-zinc-500 hover:text-zinc-300 transition"
            >
              Clear results
            </button>
          </div>
        </Show>

        {/* Active Render Status */}
        <Show when={activeRender()}>
          <div class="bg-zinc-900 rounded-xl p-6 border border-zinc-800 mb-8">
            <h2 class="text-lg font-semibold mb-3">Current Render</h2>
            <div class="flex items-center gap-3">
              <div
                class={`w-3 h-3 rounded-full ${
                  activeRender()!.status === "done"
                    ? "bg-green-500"
                    : activeRender()!.status === "error"
                      ? "bg-red-500"
                      : "bg-yellow-500 animate-pulse"
                }`}
              />
              <span class="text-zinc-300 capitalize">
                {activeRender()!.status}
              </span>
              <Show when={activeRender()!.status === "done"}>
                <div class="ml-auto flex gap-2">
                  <select
                    id="post-platform"
                    class="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white"
                  >
                    <option value="tiktok">TikTok</option>
                    <option value="reels">Instagram Reels</option>
                    <option value="shorts">YouTube Shorts</option>
                  </select>
                  <button
                    onClick={async () => {
                      const platform =
                        (
                          document.getElementById(
                            "post-platform",
                          ) as HTMLSelectElement
                        )?.value || "tiktok";
                      try {
                        const res = await fetch(`${API}/post-now`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            renderId: activeRender()!.id,
                            platform,
                          }),
                        });
                        const data = await res.json();
                        if (data.postUrl) {
                          toast(`Queued for ${platform}!`, "ok");
                          setPostQueue([
                            ...postQueue(),
                            {
                              id: data.id,
                              platform,
                              status: "queued",
                              postUrl: data.postUrl,
                            },
                          ]);
                        } else {
                          toast(data.error || "Failed to queue", "err");
                        }
                      } catch (err: any) {
                        toast(err.message, "err");
                      }
                    }}
                    class="bg-brand hover:bg-red-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition"
                  >
                    📤 Post
                  </button>
                  <a
                    href={`${API}/renders/${activeRender()!.id}/download`}
                    class="bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition"
                  >
                    Download MP4
                  </a>
                </div>
              </Show>
              <Show when={activeRender()!.status === "error"}>
                <span class="text-red-400 text-sm">
                  {activeRender()!.error}
                </span>
              </Show>
            </div>
            <Show when={activeRender()!.status === "done"}>
              <div class="mt-4">
                <video
                  controls
                  class="w-full max-w-sm rounded-lg border border-zinc-700"
                  src={`${API}/renders/${activeRender()!.id}/download`}
                />
              </div>
            </Show>
          </div>
        </Show>

        </Show>
        {/* ═══ End Create Tab ═══ */}

        {/* ═══ Projects Tab ═══ */}
        <Show when={activeTab() === "projects"}>
        {/* Project List */}
        <div class="bg-zinc-900 rounded-xl p-6 border border-zinc-800">
          <h2 class="text-lg font-semibold mb-4">Projects</h2>
          <Show
            when={projects().length > 0}
            fallback={
              <p class="text-zinc-500 text-sm">
                No projects yet. Create one above!
              </p>
            }
          >
            <div class="space-y-2">
              <For each={projects()}>
                {(p) => (
                  <div class="bg-zinc-800 rounded-lg overflow-hidden">
                    <div
                      class="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-zinc-750 transition"
                      onClick={() => toggleProject(p.id)}
                    >
                      <div class="flex items-center gap-2">
                        <span class="text-zinc-500 text-xs w-4">
                          {expandedProject() === p.id ? "▼" : "▶"}
                        </span>
                        <span class="font-medium">{p.name}</span>
                        <span class="text-xs text-zinc-400 bg-zinc-700 px-2 py-0.5 rounded">
                          {p.type}
                        </span>
                        <Show when={p.clientId}>
                          <span class="text-xs text-emerald-300 bg-emerald-900/40 px-2 py-0.5 rounded">
                            🏛️ {clients().find((c) => c.id === p.clientId)?.name ?? "Unknown client"}
                          </span>
                        </Show>
                        <span class="text-xs text-zinc-500">
                          {formatDate(p.createdAt)}
                        </span>
                      </div>
                      <div class="flex items-center gap-3">
                        <span
                          class={`text-xs px-2 py-0.5 rounded ${
                            p.status === "done"
                              ? "bg-green-900 text-green-300"
                              : p.status === "error"
                                ? "bg-red-900 text-red-300"
                                : "bg-zinc-700 text-zinc-300"
                          }`}
                        >
                          {p.status}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteProject(p.id);
                          }}
                          class="text-zinc-500 hover:text-red-400 text-xs transition"
                        >
                          delete
                        </button>
                      </div>
                    </div>
                    <Show when={expandedProject() === p.id}>
                      <div class="border-t border-zinc-700 px-4 py-3">
                        {p.script && (
                          <p class="text-xs text-zinc-400 mb-3 line-clamp-2">
                            {p.script}
                          </p>
                        )}
                        <Show
                          when={(projectRenders()[p.id] ?? []).length > 0}
                          fallback={
                            <p class="text-xs text-zinc-500">No renders yet</p>
                          }
                        >
                          <div class="space-y-2">
                            <For each={projectRenders()[p.id] ?? []}>
                              {(r) => (
                                <div class="flex items-center gap-3 bg-zinc-900 rounded-lg px-3 py-2">
                                  <Show
                                    when={r.status === "done" && r.outputPath}
                                  >
                                    <video
                                      src={`${API}/renders/${r.id}/download`}
                                      class="w-20 h-12 object-cover rounded bg-black"
                                      preload="metadata"
                                      muted
                                      onmouseover={(e) =>
                                        (
                                          e.currentTarget as HTMLVideoElement
                                        ).play()
                                      }
                                      onmouseout={(e) => {
                                        const v =
                                          e.currentTarget as HTMLVideoElement;
                                        v.pause();
                                        v.currentTime = 0;
                                      }}
                                    />
                                  </Show>
                                  <Show when={r.status !== "done"}>
                                    <div class="w-20 h-12 rounded bg-zinc-800 flex items-center justify-center text-xs text-zinc-500">
                                      {r.status}
                                    </div>
                                  </Show>
                                  <div class="flex-1 min-w-0">
                                    <p class="text-xs text-zinc-300 truncate">
                                      {r.settings
                                        ? `${JSON.parse(r.settings).platform ?? "9:16"} / ${JSON.parse(r.settings).quality ?? "standard"}`
                                        : "No settings"}
                                    </p>
                                    <p class="text-xs text-zinc-500">
                                      {formatDate(r.createdAt)}
                                    </p>
                                  </div>
                                  <Show
                                    when={r.status === "done" && r.outputPath}
                                  >
                                    <a
                                      href={`${API}/renders/${r.id}/download`}
                                      class="text-xs text-brand hover:underline shrink-0"
                                      download={`crayo-${r.id}.mp4`}
                                    >
                                      download
                                    </a>
                                  </Show>
                                  <button
                                    onClick={() => deleteRender(p.id, r.id)}
                                    class="text-zinc-500 hover:text-red-400 text-xs transition shrink-0"
                                  >
                                    delete
                                  </button>
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        </Show>
        {/* ═══ End Projects Tab ═══ */}

        {/* Media Library — visible on Create tab */}
        <Show when={activeTab() === "create"}>
        <div class="bg-zinc-900 rounded-xl p-6 border border-zinc-800 mt-6">
          <h2 class="text-lg font-semibold mb-4">Media Library</h2>

          <div class="mb-6">
            <h3 class="text-sm font-medium text-zinc-400 mb-2">
              Stock Footage
            </h3>
            <Show
              when={stocks().length > 0}
              fallback={
                <p class="text-zinc-500 text-xs">No clips in assets/stocks/</p>
              }
            >
              <div class="space-y-1">
                <For each={stocks()}>
                  {(clip) => (
                    <div class="flex items-center justify-between bg-zinc-800 rounded-lg px-3 py-2">
                      <div class="flex items-center gap-2 min-w-0">
                        <span class="text-zinc-500 text-xs">🎥</span>
                        <span class="text-sm truncate">{clip.name}</span>
                        <span class="text-xs text-zinc-500">
                          {formatSize(clip.size)}
                        </span>
                      </div>
                      <button
                        onClick={() => deleteStock(clip.name)}
                        class="text-zinc-500 hover:text-red-400 text-xs transition ml-2 shrink-0"
                      >
                        delete
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>

          <div>
            <h3 class="text-sm font-medium text-zinc-400 mb-2">
              Background Music
            </h3>
            <Show
              when={music().length > 0}
              fallback={
                <p class="text-zinc-500 text-xs">No tracks in assets/styles/</p>
              }
            >
              <div class="space-y-1">
                <For each={music()}>
                  {(track) => (
                    <div class="flex items-center justify-between bg-zinc-800 rounded-lg px-3 py-2">
                      <div class="flex items-center gap-2 min-w-0">
                        <span class="text-zinc-500 text-xs">🎵</span>
                        <span class="text-sm truncate">{track.name}</span>
                        <span class="text-xs text-zinc-500">
                          {formatSize(track.size)}
                        </span>
                      </div>
                      <button
                        onClick={() => deleteMusic(track.name)}
                        class="text-zinc-500 hover:text-red-400 text-xs transition ml-2 shrink-0"
                      >
                        delete
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
        </Show>
        {/* ═══ End Media Library (Create tab) ═══ */}
      </main>
    </div>
  );
}

// Simple signal wrapper
function useSignal<T>(initial: T) {
  return createSignal(initial);
}
