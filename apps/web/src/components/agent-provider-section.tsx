"use client";

import type {
  BuiltinProviderConfig,
  BuiltinProviderPreset,
} from "@cucumber/shared";
import { Eye, EyeOff, Key, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";

import { useAgentSettings } from "@/hooks/use-agent-settings";
import { BUILTIN_PROVIDER_PRESETS } from "@/lib/builtin-provider-presets";

import { Button } from "./ui/button";
import { Label } from "./ui/label";

// ---------------------------------------------------------------------------
// Inline Provider Form
// ---------------------------------------------------------------------------

const inputClass =
  "flex h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function ProviderForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: BuiltinProviderConfig;
  onSave: (data: Omit<BuiltinProviderConfig, "id">) => void;
  onCancel: () => void;
}) {
  const [preset, setPreset] = useState<string | null>(
    initial
      ? (BUILTIN_PROVIDER_PRESETS.find((p) => p.id === initial.type)?.id ??
          null)
      : null,
  );
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [baseURL, setBaseURL] = useState(initial?.baseURL ?? "");
  const [showKey, setShowKey] = useState(false);

  const selectedPreset = preset
    ? (BUILTIN_PROVIDER_PRESETS.find((p) => p.id === preset) ?? null)
    : null;

  const canSave =
    displayName.trim().length > 0 &&
    apiKey.trim().length > 0 &&
    model.trim().length > 0;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Provider</Label>
          <select
            value={preset ?? ""}
            onChange={(e) => {
              const p = e.target.value;
              setPreset(p);
              const cfg = BUILTIN_PROVIDER_PRESETS.find((c) => c.id === p);
              if (cfg) {
                if (!displayName.trim()) setDisplayName(cfg.label);
                if (!baseURL.trim()) setBaseURL(cfg.baseURL);
                if (!model.trim()) setModel(cfg.modelPlaceholder);
              }
            }}
            className={inputClass}
          >
            <option value="" disabled>
              Select provider...
            </option>
            {BUILTIN_PROVIDER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Display Name</Label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={selectedPreset?.label}
            className={inputClass}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">API Key</Label>
        <div className="relative">
          <Key
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40"
          />
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={selectedPreset?.placeholder ?? "sk-..."}
            className={`${inputClass} pl-7 pr-8 font-mono`}
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
          >
            {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Model</Label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={selectedPreset?.modelPlaceholder ?? "model-name"}
            className={`${inputClass} font-mono`}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Base URL</Label>
          <input
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            placeholder="https://api.example.com/v1"
            className={`${inputClass} font-mono`}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() =>
            onSave({
              displayName: displayName.trim(),
              type: (selectedPreset?.type ??
                "openai-compat") as BuiltinProviderConfig["type"],
              apiKey: apiKey.trim(),
              model: model.trim(),
              baseURL: baseURL.trim() || undefined,
              enabled: initial?.enabled ?? true,
              region: "global",
            })
          }
          disabled={!canSave}
        >
          {initial ? "Save" : "Add Provider"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provider Card (display mode)
// ---------------------------------------------------------------------------

function ProviderCard({ provider }: { provider: BuiltinProviderConfig }) {
  const { updateBuiltinProvider, removeBuiltinProvider } = useAgentSettings();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <ProviderForm
        initial={provider}
        onSave={(data) => {
          updateBuiltinProvider(provider.id, data);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const masked =
    provider.apiKey.length > 12
      ? `${provider.apiKey.slice(0, 7)}***${provider.apiKey.slice(-3)}`
      : "***";

  return (
    <div className="group flex items-center gap-3 rounded-lg border px-3 py-2.5 bg-secondary/20">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/8">
        <Key size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium leading-tight">
          {provider.displayName}
        </span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground leading-tight">
          {provider.model} · {masked}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={provider.enabled}
            onChange={(e) =>
              updateBuiltinProvider(provider.id, { enabled: e.target.checked })
            }
            className="peer sr-only"
          />
          <div className="h-5 w-9 rounded-full bg-muted peer-checked:bg-primary transition-colors after:absolute after:start-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full" />
        </label>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="h-6 w-6 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted flex items-center justify-center"
        >
          <Pencil size={11} />
        </button>
        <button
          type="button"
          onClick={() => removeBuiltinProvider(provider.id)}
          className="h-6 w-6 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-destructive"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provider Section — list + add
// ---------------------------------------------------------------------------

export function AgentProviderSection() {
  const { settings, addBuiltinProvider } = useAgentSettings();
  const [showForm, setShowForm] = useState(false);

  const handleAdd = useCallback(
    (data: Omit<BuiltinProviderConfig, "id">) => {
      addBuiltinProvider({
        ...data,
        id: `bp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      });
      setShowForm(false);
    },
    [addBuiltinProvider],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Custom Providers</h3>
          <p className="text-[11px] text-muted-foreground">
            Add your own AI providers with API keys. Keys are stored locally in
            your browser.
          </p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            <Plus size={12} /> Add
          </button>
        )}
      </div>

      {showForm && (
        <ProviderForm onSave={handleAdd} onCancel={() => setShowForm(false)} />
      )}

      {settings.builtinProviders.map((bp) => (
        <ProviderCard key={bp.id} provider={bp} />
      ))}

      {!showForm && settings.builtinProviders.length === 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">
          No custom providers configured yet.
        </p>
      )}
    </div>
  );
}
