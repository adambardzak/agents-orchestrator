import { defineStore } from 'pinia';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  contextType: 'personal' | 'cez';
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  sessionCount: number;
  totalCostUsd: number;
  lastSessionAt: string | null;
}

export const useProjectStore = defineStore('project', () => {
  const projects = ref<Project[]>([]);
  const activeProject = ref<Project | null>(null);
  const loading = ref(false);

  /**
   * Bumped whenever a Document Agent completes for the active project.
   * Pages watching this can auto-refresh their vault file listing.
   */
  const vaultUpdateTick = ref(0);
  function notifyVaultUpdated() { vaultUpdateTick.value++; }

  /** Switch the active project — persisted to localStorage via Pinia persist plugin if needed. */
  function setActiveProject(project: Project | null) {
    activeProject.value = project;
  }

  function setProjects(list: Project[]) {
    projects.value = list;
    // Auto-select first project if none active
    if (!activeProject.value && list.length > 0) {
      activeProject.value = list[0] ?? null;
    }
  }

  function upsertProject(project: Project) {
    const idx = projects.value.findIndex((p) => p.id === project.id);
    if (idx >= 0) {
      projects.value[idx] = project;
    } else {
      projects.value.unshift(project);
    }
  }

  function removeProject(id: string) {
    projects.value = projects.value.filter((p) => p.id !== id);
    if (activeProject.value?.id === id) {
      activeProject.value = projects.value[0] ?? null;
    }
  }

  return {
    projects,
    activeProject,
    loading,
    vaultUpdateTick,
    setActiveProject,
    setProjects,
    upsertProject,
    removeProject,
    notifyVaultUpdated,
  };
});
