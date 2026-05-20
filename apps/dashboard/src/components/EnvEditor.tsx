"use client";

import { useState } from "react";
import { saveProjectEnvs } from "@/app/actions";

interface Env {
  id?: string;
  key: string;
  value: string;
  branch?: string | null;
}

export default function EnvEditor({
  projectId,
  initialEnvs,
  availableBranches,
}: {
  projectId: string;
  initialEnvs: Env[];
  availableBranches: string[];
}) {
  const [envs, setEnvs] = useState<Env[]>(
    initialEnvs.length > 0 ? initialEnvs : [{ key: "", value: "", branch: "" }],
  );
  const [isSaving, setIsSaving] = useState(false);

  const addRow = () => setEnvs([...envs, { key: "", value: "", branch: "" }]);

  const removeRow = (index: number) => {
    const newEnvs = envs.filter((_, i) => i !== index);
    setEnvs(
      newEnvs.length > 0 ? newEnvs : [{ key: "", value: "", branch: "" }],
    );
  };

  const updateRow = (index: number, field: keyof Env, val: string) => {
    setEnvs((prev) =>
      prev.map((env, i) => (i === index ? { ...env, [field]: val } : env)),
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    const result = await saveProjectEnvs(projectId, envs);
    setIsSaving(false);

    if (result.success) {
      alert(
        "✅ Changes saved! Your preview environments will reflect these values on their next build.",
      );
    } else {
      alert("❌ Failed to save: " + result.error);
    }
  };

  return (
    <section className="card">
      <div style={{ marginBottom: "2.5rem" }}>
        <h2
          style={{
            fontSize: "1.6rem",
            marginBottom: "0.5rem",
            fontFamily: "EB Garamond",
          }}
        >
          Configuration Parameters
        </h2>
        <p style={{ color: "var(--color-muted)", fontSize: "0.95rem" }}>
          Scoped variables allow you to target specific branches. Select
          "Global" for project-wide variables.
        </p>
      </div>

      <div style={{ display: "grid", gap: "1rem" }}>
        <div
          style={{
            display: "flex",
            gap: "1rem",
            padding: "0 0.5rem",
            marginBottom: "-0.5rem",
          }}
        >
          <div
            style={{
              flex: 1.5,
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "var(--color-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Variable Key
          </div>
          <div
            style={{
              flex: 2,
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "var(--color-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Value
          </div>
          <div
            style={{
              width: "160px",
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "var(--color-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Branch
          </div>
          <div style={{ width: "48px" }}></div>
        </div>

        {envs.map((env, index) => (
          <div
            key={index}
            style={{ display: "flex", gap: "1rem", alignItems: "center" }}
          >
            <input
              type="text"
              className="input"
              value={env.key}
              onChange={(e) => updateRow(index, "key", e.target.value)}
              placeholder="API_KEY"
              style={{ flex: 1.5, fontWeight: 600 }}
            />
            <input
              type="password"
              className="input"
              value={env.value}
              onChange={(e) => updateRow(index, "value", e.target.value)}
              placeholder="••••••••••••"
              style={{ flex: 2 }}
            />
            <select
              className="input"
              value={env.branch || ""}
              onChange={(e) => updateRow(index, "branch", e.target.value)}
              style={{
                width: "160px",
                fontSize: "0.85rem",
                color: env.branch ? "var(--color-primary)" : "inherit",
                appearance: "none",
                background: "var(--color-surface-soft)",
              }}
            >
              <option value="">Global (All Branches)</option>
              {availableBranches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <button
              className="btn"
              onClick={() => removeRow(index)}
              style={{
                background: "rgba(198, 69, 69, 0.05)",
                color: "#c64545",
                border: "none",
                padding: "0.9rem",
                width: "48px",
              }}
            >
              ✕
            </button>
          </div>
        ))}

        <div
          style={{
            marginTop: "2rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: "2rem",
            borderTop: "1px solid var(--color-hairline)",
          }}
        >
          <button className="btn btn-secondary" onClick={addRow}>
            + Add New Variable
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={isSaving}
            style={{ minWidth: "160px" }}
          >
            {isSaving ? "Saving..." : "Save All Changes"}
          </button>
        </div>
      </div>
    </section>
  );
}
