"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function EngineStatus() {
  const [isConnected, setIsConnected] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Check connection to the events stream
    const serverUrl = (process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001").replace(/\/$/, "");
    const es = new EventSource(`${serverUrl}/api/events`);
    
    es.onopen = () => setIsConnected(true);
    es.onerror = () => setIsConnected(false);
    
    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      // If it's a deployment update (not just a heartbeat), refresh the page data
      if (data.commitSha) {
        console.log("🔄 Global refresh triggered by SSE");
        router.refresh();
      }
    };

    return () => es.close();
  }, [router]);

  return (
    <div style={{ 
      display: 'inline-flex', 
      alignItems: 'center', 
      gap: '0.6rem',
      background: 'var(--color-surface-card)',
      padding: '0.4rem 0.8rem',
      borderRadius: '9999px',
      border: '1px solid var(--color-hairline)',
      fontSize: '0.8rem',
      fontWeight: 500,
      color: 'var(--color-ink)'
    }}>
      <span style={{ 
        color: isConnected ? '#5db872' : '#c64545',
        fontSize: '1rem',
        lineHeight: 1
      }}>
        ✦
      </span>
      <span style={{ letterSpacing: '0.02em', textTransform: 'uppercase', fontSize: '0.7rem', fontWeight: 600 }}>
        Engine {isConnected ? 'Online' : 'Offline'}
      </span>
    </div>
  );
}
