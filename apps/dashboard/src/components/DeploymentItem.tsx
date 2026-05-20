"use client";

import { useState, useEffect, useRef } from "react";
import { teardownDeployment, rebuildDeployment } from "../app/actions";

import { type Deployment, type DeploymentGroup } from "@/lib/client";

interface DeploymentItemProps {
  group: DeploymentGroup;
}

export default function DeploymentItem({ group }: DeploymentItemProps) {
  // We track the active deployment we are looking at (defaults to latest)
  const [activeIndex, setActiveIndex] = useState(0);
  const activeDep = group.items[activeIndex];

  const [dep, setDep] = useState<Deployment | undefined>(activeDep);
  const [showLogs, setShowLogs] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [showHistory, setShowHistory] = useState(false);

  // Sync state when activeIndex or group changes
  useEffect(() => {
    setDep(group.items[activeIndex]);
    setShowLogs(false);
  }, [activeIndex, group]);

  const setDepRef = useRef(setDep);
  useEffect(() => {
    setDepRef.current = setDep;
  }, [setDep]);

  useEffect(() => {
    if (!dep?.commitSha) return;

    const serverUrl = (
      process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001"
    ).replace(/\/$/, "");
    const eventSource = new EventSource(`${serverUrl}/api/events`);

    eventSource.onopen = () => setConnectionStatus("connected");

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "connected") return setConnectionStatus("connected");
      if (data.type === "heartbeat") return;

      if (dep && data.commitSha === dep.commitSha) {
        setDepRef.current((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            status: data.status,
            url: data.url,
            framework: data.framework || prev.framework,
          };
        });
      }
    };

    eventSource.onerror = () => setConnectionStatus("disconnected");
    return () => eventSource.close();
  }, [dep?.commitSha]);

  useEffect(() => {
    if (dep?.status === "building") setShowLogs(true);
  }, [dep?.status]);

  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    if (!showLogs || !dep?.commitSha) return;
    setLogs([]);
    const logSource = new EventSource(`/api/logs/${dep.commitSha}`);
    logSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.message) setLogs((prev) => [...prev, data.message]);
      } catch (err) {
        console.error("Failed to parse log message:", err);
      }
    };
    logSource.onerror = () => logSource.close();
    return () => logSource.close();
  }, [showLogs, dep?.commitSha]);

  const logContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const handleTeardown = async () => {
    if (!dep) return;
    if (!confirm("Are you sure you want to stop this deployment?")) return;
    setIsStopping(true);
    try {
      await teardownDeployment(dep.projectId, dep.branch);
    } catch (err) {
      alert("Failed to stop deployment");
      setIsStopping(false);
    }
  };

  const handleRebuild = async () => {
    if (!dep) return;
    setIsRebuilding(true);
    try {
      const res = await rebuildDeployment(dep.commitSha);
      if (!res.success) alert(res.error || "Failed to trigger rebuild");
      else setShowLogs(true);
    } catch (err) {
      alert("Failed to trigger rebuild");
    } finally {
      setIsRebuilding(false);
    }
  };

  if (!dep) return null;

  return (
    <div
      className="card-dark"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.8rem",
              marginBottom: "0.5rem",
            }}
          >
            <h3
              style={{
                fontSize: "1.8rem",
                color: "var(--color-on-dark)",
                fontWeight: 400,
              }}
            >
              {group.branch}
            </h3>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                fontSize: "0.65rem",
                color:
                  connectionStatus === "connected"
                    ? "#5db8a6"
                    : connectionStatus === "connecting"
                      ? "#ffbd2e"
                      : "#ff5f56",
                background: "rgba(255,255,255,0.03)",
                padding: "0.1rem 0.4rem",
                borderRadius: "4px",
              }}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background:
                    connectionStatus === "connected"
                      ? "#5db8a6"
                      : connectionStatus === "connecting"
                        ? "#ffbd2e"
                        : "#ff5f56",
                  boxShadow:
                    connectionStatus === "connected"
                      ? "0 0 8px #5db8a6"
                      : "none",
                }}
              ></span>
              {connectionStatus}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
            {dep.framework && (
              <span
                style={{
                  fontSize: "0.7rem",
                  color: "var(--color-primary)",
                  background: "rgba(204, 120, 92, 0.1)",
                  padding: "0.2rem 0.6rem",
                  borderRadius: "100px",
                  border: "1px solid rgba(204, 120, 92, 0.2)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  fontWeight: 600,
                }}
              >
                {dep.framework}
              </span>
            )}
            {dep.status === "running" && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  color: "#5db8a6",
                  background: "rgba(93, 184, 166, 0.1)",
                  padding: "0.2rem 0.5rem",
                  borderRadius: "4px",
                  textTransform: "uppercase",
                }}
              >
                <span
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: "#5db8a6",
                  }}
                ></span>
                Live
              </span>
            )}
          </div>
          <p
            style={{
              color: "rgba(255,255,255,0.4)",
              fontSize: "0.9rem",
              display: "flex",
              gap: "0.5rem",
              alignItems: "center",
              marginTop: "0.5rem",
            }}
          >
            <code
              style={{
                background: "rgba(255,255,255,0.05)",
                padding: "0.2rem 0.4rem",
                borderRadius: "4px",
                color: "var(--color-on-dark)",
              }}
            >
              {dep.commitSha.substring(0, 7)}
            </code>
            <span>—</span>
            <span
              style={{
                fontStyle: "italic",
                maxWidth: "400px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {dep.commitMessage || "No commit message"}
            </span>
          </p>
        </div>

        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <button
            onClick={() => setShowHistory(!showHistory)}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.3)",
              cursor: "pointer",
              fontSize: "0.8rem",
              padding: "0.4rem",
              borderRadius: "4px",
              borderBottom: showHistory
                ? "1px solid var(--color-primary)"
                : "none",
            }}
          >
            History ({group.items.length})
          </button>
          <div
            style={{
              background:
                dep.status === "running"
                  ? "rgba(93, 184, 114, 0.1)"
                  : dep.status === "failed"
                    ? "rgba(255, 77, 77, 0.1)"
                    : "rgba(255, 255, 255, 0.05)",
              color:
                dep.status === "running"
                  ? "#5db872"
                  : dep.status === "failed"
                    ? "#ff4d4d"
                    : "#888",
              padding: "0.4rem 0.8rem",
              borderRadius: "6px",
              fontSize: "0.8rem",
              fontWeight: 600,
              textTransform: "uppercase",
            }}
          >
            {dep.status}
          </div>
        </div>
      </div>

      {showHistory && (
        <div
          style={{
            background: "rgba(0,0,0,0.2)",
            padding: "1rem",
            borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.05)",
            display: "grid",
            gap: "0.5rem",
          }}
        >
          {group.items.map((item, idx) => (
            <div
              key={item.id}
              onClick={() => setActiveIndex(idx)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "0.6rem 1rem",
                borderRadius: "4px",
                cursor: "pointer",
                background:
                  idx === activeIndex
                    ? "rgba(255,255,255,0.05)"
                    : "transparent",
                borderLeft:
                  idx === activeIndex
                    ? "2px solid var(--color-primary)"
                    : "2px solid transparent",
              }}
            >
              <div
                style={{ display: "flex", gap: "1rem", alignItems: "center" }}
              >
                <code style={{ fontSize: "0.8rem", opacity: 0.6 }}>
                  {item.commitSha.substring(0, 7)}
                </code>
                <span
                  style={{
                    fontSize: "0.85rem",
                    opacity: idx === activeIndex ? 1 : 0.6,
                  }}
                >
                  {item.commitMessage}
                </span>
              </div>
              <span style={{ fontSize: "0.75rem", opacity: 0.4 }}>
                {new Date(item.createdAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: "1rem" }}>
        {dep.url && (
          <a
            href={dep.url || undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
            style={{ flex: 1, textDecoration: "none" }}
          >
            Visit Preview
          </a>
        )}
        <button
          className="btn"
          onClick={handleRebuild}
          disabled={isRebuilding || dep.status === "building"}
          style={{
            background: "var(--color-primary)",
            color: "white",
            border: "none",
            flex: 1,
            opacity: isRebuilding || dep.status === "building" ? 0.5 : 1,
            fontWeight: 600,
          }}
        >
          {isRebuilding ? "Queuing..." : "Rebuild"}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => setShowLogs(!showLogs)}
          style={{
            background: "var(--color-surface-dark-elevated)",
            border: "none",
            color: "var(--color-on-dark)",
            flex: dep.url ? 0 : 1,
          }}
        >
          {showLogs ? "Hide Logs" : "Logs"}
        </button>
        <button
          className="btn"
          onClick={handleTeardown}
          disabled={isStopping || dep.status === "stopped"}
          style={{
            background: "rgba(255, 77, 77, 0.05)",
            color: "#ff4d4d",
            border: "none",
            fontSize: "0.85rem",
          }}
        >
          {isStopping ? "Stopping..." : "Teardown"}
        </button>
      </div>

      {showLogs && (
        <div
          ref={logContainerRef}
          style={{
            marginTop: "1rem",
            padding: "1.5rem",
            background: "#0d0d0c",
            borderRadius: "8px",
            maxHeight: "400px",
            overflowY: "auto",
            border: "1px solid rgba(255,255,255,0.05)",
            boxShadow: "inset 0 4px 20px rgba(0,0,0,0.6)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "1.5rem",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              paddingBottom: "0.8rem",
            }}
          >
            <h4
              style={{
                color: "var(--color-on-dark)",
                fontSize: "0.8rem",
                fontFamily: "Inter",
                textTransform: "uppercase",
                letterSpacing: "0.15em",
                fontWeight: 600,
              }}
            >
              Build Terminal
            </h4>
            <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
              <span style={{ color: "#444", fontSize: "0.7rem" }}>
                {logs.length || (dep.logs ? dep.logs.split("\n").length : 0)}{" "}
                lines
              </span>
              <div style={{ display: "flex", gap: "0.3rem" }}>
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: "#ff5f56",
                  }}
                ></span>
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: "#ffbd2e",
                  }}
                ></span>
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: "#27c93f",
                  }}
                ></span>
              </div>
            </div>
          </div>
          <pre
            style={{
              fontSize: "0.85rem",
              color: "#d1d1d1",
              whiteSpace: "pre-wrap",
              fontFamily: "JetBrains Mono",
              lineHeight: 1.7,
            }}
          >
            {logs.length > 0
              ? logs.join("\n")
              : dep.logs
                ? dep.logs
                : dep.status === "building"
                  ? "Initializing build stream..."
                  : "No logs recorded for this build."}
          </pre>
        </div>
      )}
    </div>
  );
}
