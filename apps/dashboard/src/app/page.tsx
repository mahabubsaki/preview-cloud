import { client } from "@/lib/client";
import EngineStatus from "@/components/EngineStatus";
import DeploymentItem from "@/components/DeploymentItem";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { data: activeDeployments, error } = await client.api.deployments.get();

  if (error || !activeDeployments) {
    return (
      <div
        className="card"
        style={{ marginTop: "2rem", borderColor: "var(--color-primary)" }}
      >
        <h2 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>
          Connection Error
        </h2>
        <p>
          The API server (port 3001) appears to be offline. Please check your
          orchestrator and server status.
        </p>
      </div>
    );
  }

  const allItems = activeDeployments.flatMap((group) => group.items);
  const runningCount = allItems.filter((d) => d.status === "running").length;
  const buildingCount = allItems.filter(
    (d) => d.status === "building" || d.status === "pending",
  ).length;

  return (
    <div style={{ paddingTop: "1rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "3rem",
          paddingBottom: "2rem",
          borderBottom: "1px solid var(--color-hairline)",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "4.5rem",
              letterSpacing: "-0.04em",
              marginBottom: "0rem",
            }}
          >
            Deployment Center
          </h1>
          <p
            style={{
              color: "var(--color-muted)",
              fontSize: "1.1rem",
              marginTop: "0.5rem",
            }}
          >
            Manage and monitor your ephemeral preview environments.
          </p>
        </div>
        <div style={{ display: "flex", gap: "2rem", alignItems: "center" }}>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "var(--color-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              Status
            </div>
            <EngineStatus />
          </div>
          <div
            style={{
              width: "1px",
              height: "30px",
              background: "var(--color-hairline)",
            }}
          ></div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "var(--color-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              Active
            </div>
            <div
              style={{
                fontSize: "1.5rem",
                fontWeight: 500,
                fontFamily: "EB Garamond",
              }}
            >
              {runningCount}{" "}
              <span style={{ fontSize: "0.9rem", color: "#5db872" }}>
                Running
              </span>
            </div>
          </div>
          {buildingCount > 0 && (
            <>
              <div
                style={{
                  width: "1px",
                  height: "30px",
                  background: "var(--color-hairline)",
                }}
              ></div>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "var(--color-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  Queue
                </div>
                <div
                  style={{
                    fontSize: "1.5rem",
                    fontWeight: 500,
                    fontFamily: "EB Garamond",
                  }}
                >
                  {buildingCount}{" "}
                  <span
                    style={{
                      fontSize: "0.9rem",
                      color: "var(--color-primary)",
                    }}
                  >
                    Building
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gap: "1.5rem" }}>
        {activeDeployments.length === 0 ? (
          <div
            className="card"
            style={{
              textAlign: "center",
              padding: "6rem 2rem",
              background: "var(--color-surface-soft)",
              borderStyle: "dashed",
            }}
          >
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>☁️</div>
            <h2 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
              No active deployments
            </h2>
            <p style={{ color: "var(--color-muted)" }}>
              Push code to any connected repository to see magic happen.
            </p>
          </div>
        ) : (
          activeDeployments.map((group) => (
            <DeploymentItem key={group.id} group={group} />
          ))
        )}
      </div>
    </div>
  );
}
