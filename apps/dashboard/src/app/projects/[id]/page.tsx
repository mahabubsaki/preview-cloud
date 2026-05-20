import { client } from "@/lib/client";
import { notFound } from "next/navigation";
import EnvEditor from "@/components/EnvEditor";

export const dynamic = "force-dynamic";

export default async function ProjectEnvPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // 1. Fetch Project Details via Eden
  const { data: project, error: projectError } = await client.api.projects({ id }).get();
  if (projectError || !project) return notFound();

  // 2. Fetch Project ENVs via Eden
  const { data: envs, error: envsError } = await client.api.projects({ id }).envs.get();
  if (envsError || !envs) return notFound();

  // 3. Fetch Project Branches
  const { data: branches, error: branchesError } = await client.api.projects({ id }).branches.get();
  if (branchesError || !branches) return notFound();

  return (
    <div style={{ paddingTop: '2rem' }}>
      <div style={{ marginBottom: '4rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ fontSize: '4.5rem', marginBottom: '0.5rem' }}>{project.name}</h1>
          <p style={{ color: 'var(--color-muted)', fontSize: '1.2rem' }}>
            Project ID: <code style={{ background: 'var(--color-surface-soft)', padding: '0.2rem 0.4rem', borderRadius: '4px' }}>{project.id}</code>
          </p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button className="btn btn-secondary">Project Settings</button>
        </div>
      </div>

      <div style={{ marginBottom: '4rem' }}>
        <h2 style={{ fontSize: '2rem', marginBottom: '1.5rem' }}>Environment Variables</h2>
        <EnvEditor projectId={project.id} initialEnvs={envs} availableBranches={branches} />
      </div>

      <div className="card" style={{ 
        marginTop: '6rem', 
        border: '1px solid #eecaca', 
        background: '#fff5f5' 
      }}>
        <h4 style={{ color: '#c64545', fontSize: '1.4rem', marginBottom: '0.5rem', fontFamily: 'EB Garamond' }}>Danger Zone</h4>
        <p style={{ fontSize: '0.95rem', color: '#7a5a5a', marginBottom: '1.5rem' }}>
          Deleting this project will permanently remove all associated deployments, preview URLs, and sensitive environment variables. This action cannot be undone.
        </p>
        <button className="btn" style={{ background: '#c64545', color: 'white', border: 'none' }}>
          Delete Project
        </button>
      </div>
    </div>
  );
}
