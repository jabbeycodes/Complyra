/**
 * Recognition domain types — winners-only weekly recognition for Complyrer.
 *
 * Two private, bidirectional review directions:
 *   - DSP rates their House Manager  (dsp_hm_ratings)
 *   - HM reviews their DSP           (hm_dsp_reviews)
 * Exactly one current record per reviewer/subject pair and direction; every
 * change appends to history (never silently overwritten); the reviewed person
 * is notified on each change.
 */
import type { HmBreakdown, DspBreakdown, WinnerCategory } from "./scoring";

export type { WinnerCategory };

/** Breakdown of one candidate's weekly score (kept private; see below). */
export type ScoreBreakdown = HmBreakdown | DspBreakdown;

export interface DspHmRating {
  id: string;
  agencyId: string;
  dspId: string;
  hmId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  updatedAt: string;
}

export interface HmDspReview {
  id: string;
  agencyId: string;
  hmId: string;
  dspId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  updatedAt: string;
}

export interface RatingHistoryEntry {
  id: string;
  oldRating: number | null; // null on the first rating
  newRating: number;
  changedBy: string;
  changedByName: string | null;
  createdAt: string;
}

export interface DspHmRatingWithHistory extends DspHmRating {
  hmName: string;
  dspName: string;
  history: RatingHistoryEntry[];
}

export interface HmDspReviewWithHistory extends HmDspReview {
  hmName: string;
  dspName: string;
  history: RatingHistoryEntry[];
}

/** Managers/admins view: every current pair in the agency (current only). */
export interface RecognitionFeedback {
  dspRatings: DspHmRatingWithHistory[];
  hmReviews: HmDspReviewWithHistory[];
}

/** Public celebration row: winner + positive highlights only. No rankings. */
export interface RecognitionWinner {
  id: string;
  weekStart: string; // Monday, YYYY-MM-DD
  category: WinnerCategory;
  winnerId: string;
  winnerName: string;
  highlights: string[];
  decidedAt: string;
}

/**
 * The winner-only public shape served to the celebration surface.
 * Deliberately omits winnerId, scores, and breakdowns: the public never sees
 * anything that could reconstruct a ranking.
 */
export interface PublicRecognitionWinner {
  id: string;
  weekStart: string; // Monday, YYYY-MM-DD
  category: WinnerCategory;
  winnerName: string;
  highlights: string[];
  decidedAt: string;
}

export interface WeeklyRecognitionResult {
  weekStart: string;
  hmWinner: { id: string; fullName: string } | null;
  dspWinner: { id: string; fullName: string } | null;
  alreadyDecided: boolean;
}
