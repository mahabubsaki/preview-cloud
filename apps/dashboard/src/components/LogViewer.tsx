"use client";

import { useEffect, useState, useRef } from "react";

export default function LogViewer({ commitSha }: { commitSha: string }) {
  const [logs, setLogs] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const eventSource = new EventSource(`/api/logs/${commitSha}`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setLogs((prev) => [...prev, data.message]);
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => eventSource.close();
  }, [commitSha]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div 
      ref={scrollRef}
      style={{ 
        background: '#000', 
        color: '#0f0', 
        fontFamily: 'monospace', 
        padding: '1rem', 
        height: '300px', 
        overflowY: 'auto', 
        borderRadius: '8px',
        fontSize: '0.85rem',
        border: '1px solid #333',
        marginTop: '1rem'
      }}
    >
      {logs.length === 0 && <div style={{ color: '#555' }}>Waiting for logs...</div>}
      {logs.map((log, i) => (
        <div key={i} style={{ whiteSpace: 'pre-wrap', marginBottom: '0.2rem' }}>
          {log}
        </div>
      ))}
    </div>
  );
}
