const Session = require('../../src/models/Session');
const sessionService = require('../../src/services/sessionService');
const { createUserWithToken } = require('../helpers/factories');

describe('reapOrphanedActiveSessions', () => {
  test('marks every status=active session as aborted, leaving other statuses untouched', async () => {
    const { user } = await createUserWithToken();

    const stale1 = await Session.create({ userId: user._id, status: 'active', startedAt: new Date(Date.now() - 60 * 60 * 1000) });
    const stale2 = await Session.create({ userId: user._id, status: 'active', startedAt: new Date() });
    const completed = await Session.create({ userId: user._id, status: 'completed', startedAt: new Date(), endedAt: new Date() });

    const count = await sessionService.reapOrphanedActiveSessions();
    expect(count).toBe(2);

    const [reloaded1, reloaded2, reloadedCompleted] = await Promise.all([
      Session.findById(stale1._id),
      Session.findById(stale2._id),
      Session.findById(completed._id),
    ]);

    expect(reloaded1.status).toBe('aborted');
    expect(reloaded1.endedAt).toBeInstanceOf(Date);
    expect(reloaded2.status).toBe('aborted');
    expect(reloadedCompleted.status).toBe('completed'); // untouched
  });

  test('is a no-op when there are no active sessions', async () => {
    const count = await sessionService.reapOrphanedActiveSessions();
    expect(count).toBe(0);
  });
});
