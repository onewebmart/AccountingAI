import { withOrg, tenantContext } from './tenant.plugin';

describe('tenantContext', () => {
  it('should run with org context and expose orgId', async () => {
    let capturedOrgId: string | undefined;

    await withOrg('org_test_123', async () => {
      capturedOrgId = tenantContext.getStore()?.orgId;
    });

    expect(capturedOrgId).toBe('org_test_123');
  });

  it('should isolate context between concurrent runs', async () => {
    const results: string[] = [];

    await Promise.all([
      withOrg('org_A', async () => {
        await new Promise((r) => setTimeout(r, 10));
        results.push(tenantContext.getStore()?.orgId ?? 'none');
      }),
      withOrg('org_B', async () => {
        results.push(tenantContext.getStore()?.orgId ?? 'none');
      }),
    ]);

    expect(results).toContain('org_A');
    expect(results).toContain('org_B');
    // They must not bleed into each other
    expect(results).not.toContain('none');
  });

  it('should return undefined outside a context', () => {
    const store = tenantContext.getStore();
    expect(store).toBeUndefined();
  });
});
