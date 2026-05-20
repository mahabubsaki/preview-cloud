export default function SettingsPage() {
  return (
    <div>
      <div style={{ marginBottom: "2.5rem" }}>
        <h1 style={{ fontSize: "3rem", fontWeight: 900, letterSpacing: "-0.02em" }}>
          Settings
        </h1>
        <p style={{ color: "#888", fontSize: "1.1rem", marginTop: "0.5rem" }}>
          Global configuration and system preferences.
        </p>
      </div>

      <div style={{ display: 'grid', gap: '2rem', maxWidth: '800px' }}>
        <section className="card" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '1.5rem' }}>System Configuration</h2>
          
          <div style={{ marginBottom: "1.5rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 700, fontSize: '0.9rem', color: '#aaa' }}>
              BASE PREVIEW DOMAIN
            </label>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <input 
                type="text" 
                className="input" 
                value="localhost" 
                readOnly 
                style={{ flex: 1, background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.05)", padding: "1rem", borderRadius: "12px", color: "#fff", cursor: 'not-allowed' }}
              />
              <button className="btn" disabled style={{ background: 'rgba(255,255,255,0.02)', color: '#444' }}>Change</button>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#555', marginTop: '0.5rem' }}>
              Subdomains will be generated based on this domain (e.g., project-branch.localhost).
            </p>
          </div>

          <div style={{ padding: '1rem', borderRadius: '12px', background: 'rgba(50, 145, 255, 0.05)', border: '1px solid rgba(50, 145, 255, 0.1)' }}>
            <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#3291ff', marginBottom: '0.5rem' }}>Environment Managed</h4>
            <p style={{ fontSize: '0.85rem', color: '#888', lineHeight: '1.5' }}>
              Notification channels, Redis credentials, and GitHub App secrets are managed via system environment variables for maximum security.
            </p>
          </div>
        </section>

        <section className="card" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', opacity: 0.5 }}>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '0.5rem' }}>Danger Zone</h2>
          <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1.5rem' }}>Irreversible actions that affect the entire cluster.</p>
          <button className="btn" disabled style={{ background: 'rgba(255, 77, 77, 0.05)', color: '#ff4d4d', border: '1px solid rgba(255, 77, 77, 0.1)' }}>
            Prune All Containers
          </button>
        </section>
      </div>
    </div>
  );
}
