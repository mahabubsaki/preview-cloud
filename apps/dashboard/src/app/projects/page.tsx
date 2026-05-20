import { client } from "@/lib/client";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const { data: projects, error } = await client.api.projects.get();

  if (error || !projects) {
    return <div className="card">Error loading projects.</div>;
  }

  return (
    <div style={{ paddingTop: "2rem" }}>
      <div style={{ marginBottom: "4rem" }}>
        <h1 style={{ fontSize: "4.5rem", marginBottom: "0.5rem" }}>Projects</h1>
        <p style={{ color: "var(--color-muted)", fontSize: "1.2rem" }}>
          Manage your connected repositories and environment variables.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
          gap: "2rem",
        }}
      >
        {projects.length === 0 ? (
          <div
            className="card"
            style={{
              gridColumn: "1/-1",
              textAlign: "center",
              padding: "8rem",
              color: "var(--color-muted)",
            }}
          >
            No projects found. Install the GitHub App on a repo to get started!
          </div>
        ) : (
          projects.map((project) => (
            <div
              key={project.id}
              className="card"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1.5rem",
                transition: "transform 0.2s, box-shadow 0.2s",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <h3 style={{ fontSize: "1.8rem", marginBottom: "0.2rem" }}>
                    {project.name}
                  </h3>
                  <code
                    style={{ color: "var(--color-muted)", fontSize: "0.8rem" }}
                  >
                    {project.id}
                  </code>
                </div>
                <span
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    color: "#5db872",
                    background: "rgba(93, 184, 114, 0.1)",
                    padding: "0.3rem 0.6rem",
                    borderRadius: "4px",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Active
                </span>
              </div>

              <div style={{ display: "flex", gap: "1rem", marginTop: "auto" }}>
                <Link
                  href={`/projects/${project.id}`}
                  className="btn btn-primary"
                  style={{
                    textDecoration: "none",
                    flex: 1,
                    textAlign: "center",
                  }}
                >
                  Settings
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
