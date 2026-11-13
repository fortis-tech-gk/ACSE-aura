import { router } from 'expo-router';
import { notify } from '@/lib/officials/confirm';

/** What the server did after a heat was finalized (backend/src/utils/progression.ts) */
type FinalizeResult = {
  stage?: string;
  roundComplete?: boolean;
  waitingFor?: number[];
  nextRound?: { nextStage: string; heats?: { heatNumber: number; entries: number }[]; qualified?: number; skipped?: string } | null;
  pointsAwarded?: { placers_awarded?: number } | null;
};

const STAGE_NAME: Record<string, string> = { SEMI_FINAL: 'the semi-final', FINAL: 'the final' };

/** Tell the referee what happened, then go back to the home screen, which briefs the next heat */
export function afterFinalize(d: FinalizeResult | undefined, heatId: string) {
  const lines = ['Results are published to the live results, the leaderboard and the athletes’ app.'];
  if (d?.pointsAwarded) lines.push('Championship points are awarded.');
  if (d?.nextRound?.heats?.length) {
    const n = d.nextRound.heats.length;
    lines.push(`Round complete: ${d.nextRound.qualified} qualified for ${STAGE_NAME[d.nextRound.nextStage] || d.nextRound.nextStage} (first 2 of each heat). ${n === 1 ? 'The heat is' : `${n} heats are`} drawn with lanes.`);
  } else if (d?.nextRound?.skipped) {
    lines.push(d.nextRound.skipped);
  } else if (d && d.roundComplete === false && d.waitingFor?.length) {
    lines.push(`The next round is drawn when heat ${d.waitingFor.join(', ')} ${d.waitingFor.length === 1 ? 'is' : 'are'} finalized too.`);
  }
  notify('Results finalized', lines.join('\n\n'));
  router.replace({ pathname: '/officials', params: { finished: heatId } });
}
