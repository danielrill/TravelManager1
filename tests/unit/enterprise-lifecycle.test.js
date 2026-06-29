import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const k8sMock = vi.hoisted(() => {
  const batch = {
    deleteNamespacedJob: vi.fn(),
    readNamespacedJob: vi.fn(),
    createNamespacedJob: vi.fn(),
  }
  const core = {
    deleteNamespacedConfigMap: vi.fn(),
    readNamespacedConfigMap: vi.fn(),
  }
  class BatchV1Api {}
  class CoreV1Api {}
  class KubeConfig {
    loadFromCluster() {}
    makeApiClient(Api) {
      if (Api === BatchV1Api) return batch
      if (Api === CoreV1Api) return core
      throw new Error('unexpected api client')
    }
  }
  return { batch, core, BatchV1Api, CoreV1Api, KubeConfig }
})

vi.mock('@kubernetes/client-node', () => ({
  default: {
    KubeConfig: k8sMock.KubeConfig,
    BatchV1Api: k8sMock.BatchV1Api,
    CoreV1Api: k8sMock.CoreV1Api,
  },
}))

const savedEnv = { ...process.env }
const notFound = { statusCode: 404 }

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  process.env = {
    ...savedEnv,
    PROVISIONER_K8S_ENABLED: '1',
    ENTERPRISE_TF_IMAGE: 'terraform-enterprise:test',
    ENTERPRISE_TF_LOCK_TIMEOUT: '7m',
  }
  k8sMock.batch.deleteNamespacedJob.mockResolvedValue({})
  k8sMock.batch.readNamespacedJob.mockRejectedValue(notFound) // no prior Jobs by default
  k8sMock.batch.createNamespacedJob.mockResolvedValue({})
  k8sMock.core.deleteNamespacedConfigMap.mockResolvedValue({})
})

afterEach(() => {
  process.env = { ...savedEnv }
})

describe('enterprise lifecycle Jobs', () => {
  it('fires a fresh destroy with lock args and clears the stale result when no prior Job exists', async () => {
    const { destroyEnterprise } = await import('../../services/provisioner-service/utils/enterprise.js')

    await expect(destroyEnterprise('demo')).resolves.toEqual({ job: 'ent-destroy-demo' })

    // No prior Job to reap, so nothing is deleted — the apply/destroy names are read to
    // check for an in-flight run, both 404.
    expect(k8sMock.batch.deleteNamespacedJob).not.toHaveBeenCalled()
    expect(k8sMock.batch.readNamespacedJob.mock.calls.map((c) => c[0])).toEqual([
      'ent-apply-demo',
      'ent-destroy-demo',
    ])
    expect(k8sMock.core.deleteNamespacedConfigMap).toHaveBeenCalledWith('ent-result-demo', 'default')

    const manifest = k8sMock.batch.createNamespacedJob.mock.calls[0][1]
    const env = Object.fromEntries(manifest.spec.template.spec.containers[0].env.map((e) => [e.name, e.value]))
    expect(manifest.metadata.name).toBe('ent-destroy-demo')
    expect(env.TF_ACTION).toBe('destroy')
    expect(env.TF_CLI_ARGS_apply).toBe('-lock-timeout=7m')
    expect(env.TF_CLI_ARGS_destroy).toBe('-lock-timeout=7m')
  })

  it('no-ops without killing an apply Job that is still running', async () => {
    // ent-apply-demo is active (no succeeded/failed) — re-triggering must NOT delete it
    // (a SIGKILL'd terraform apply orphans the GCS state lock) and must NOT create again.
    k8sMock.batch.readNamespacedJob.mockImplementation((name) =>
      name === 'ent-apply-demo' ? Promise.resolve({ body: { status: { active: 1 } } }) : Promise.reject(notFound),
    )
    const { applyEnterprise } = await import('../../services/provisioner-service/utils/enterprise.js')

    await expect(applyEnterprise('demo')).resolves.toEqual({ job: 'ent-apply-demo', alreadyRunning: 'apply' })

    expect(k8sMock.batch.deleteNamespacedJob).not.toHaveBeenCalled()
    expect(k8sMock.batch.createNamespacedJob).not.toHaveBeenCalled()
    expect(k8sMock.core.deleteNamespacedConfigMap).not.toHaveBeenCalled()
  })

  it('reaps a finished prior apply Job (Background) before re-creating', async () => {
    // ent-apply-demo finished (succeeded); its pod has exited so it is safe to reap with
    // Background propagation, then a fresh apply is created.
    let applyGone = false
    k8sMock.batch.readNamespacedJob.mockImplementation((name) => {
      if (name === 'ent-apply-demo' && !applyGone) return Promise.resolve({ body: { status: { succeeded: 1 } } })
      return Promise.reject(notFound)
    })
    k8sMock.batch.deleteNamespacedJob.mockImplementation((name) => {
      if (name === 'ent-apply-demo') applyGone = true
      return Promise.resolve({})
    })
    const { applyEnterprise } = await import('../../services/provisioner-service/utils/enterprise.js')

    await expect(applyEnterprise('demo')).resolves.toEqual({ job: 'ent-apply-demo' })

    expect(k8sMock.batch.deleteNamespacedJob).toHaveBeenCalledTimes(1)
    const [name, ns, , , , , propagation] = k8sMock.batch.deleteNamespacedJob.mock.calls[0]
    expect([name, ns, propagation]).toEqual(['ent-apply-demo', 'default', 'Background'])
    expect(k8sMock.batch.createNamespacedJob.mock.calls[0][1].metadata.name).toBe('ent-apply-demo')
  })
})
