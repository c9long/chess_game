//! Sequential probability ratio test for engine changes.
//!
//! H0: Elo difference ≤ `elo0`, H1: ≥ `elo1` (Elo in the pairwise-placement
//! sense of [`crate::rating`]). Each **sample** is one opening group: the
//! mean pairwise score of A against B over the group's seat patterns (A and B
//! swap seats on the same opening, which cancels most seat and opening
//! noise). The log-likelihood ratio uses the normal approximation of the
//! generalized SPRT (as used by Fishtest), with the sample variance:
//!
//! `LLR = N (s1 - s0) (2 x̄ - s0 - s1) / (2 σ²)`
//!
//! The test stops at `LLR ≤ ln(β / (1 - α))` (accept H0) or
//! `LLR ≥ ln((1 - β) / α)` (accept H1).

use crate::rating::{elo_from_score, score_from_elo};

/// SPRT parameters.
#[derive(Clone, Copy, Debug)]
pub struct Sprt {
    /// Elo of H0.
    pub elo0: f64,
    /// Elo of H1.
    pub elo1: f64,
    /// False positive rate.
    pub alpha: f64,
    /// False negative rate.
    pub beta: f64,
}

/// SPRT state.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Decision {
    /// Keep playing.
    Continue,
    /// H0 accepted (no improvement of at least `elo1`).
    H0,
    /// H1 accepted (improvement).
    H1,
}

/// Summary of a sample set.
#[derive(Clone, Copy, Debug)]
pub struct SprtStatus {
    /// Number of samples (groups).
    pub n: usize,
    /// Mean score of A.
    pub mean: f64,
    /// Log-likelihood ratio.
    pub llr: f64,
    /// Lower bound.
    pub lower: f64,
    /// Upper bound.
    pub upper: f64,
    /// Estimated Elo difference and its 95% interval.
    pub elo: (f64, f64, f64),
    /// Decision.
    pub decision: Decision,
}

impl Sprt {
    /// Lower and upper LLR bounds.
    pub fn bounds(&self) -> (f64, f64) {
        (
            (self.beta / (1.0 - self.alpha)).ln(),
            ((1.0 - self.beta) / self.alpha).ln(),
        )
    }

    /// Evaluates the samples (each in `[0, 1]`).
    pub fn status(&self, samples: &[f64]) -> SprtStatus {
        let (lower, upper) = self.bounds();
        let n = samples.len();
        let mean = if n == 0 {
            0.5
        } else {
            samples.iter().sum::<f64>() / n as f64
        };
        let var = if n < 2 {
            0.0
        } else {
            samples.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (n - 1) as f64
        };
        let (s0, s1) = (score_from_elo(self.elo0), score_from_elo(self.elo1));
        let llr = if n < 2 || var <= 1e-12 {
            0.0
        } else {
            n as f64 * (s1 - s0) * (2.0 * mean - s0 - s1) / (2.0 * var)
        };
        let se = if n < 2 { 0.0 } else { (var / n as f64).sqrt() };
        let elo = (
            elo_from_score(mean),
            elo_from_score(mean - 1.96 * se),
            elo_from_score(mean + 1.96 * se),
        );
        let decision = if n >= 2 && llr <= lower {
            Decision::H0
        } else if n >= 2 && llr >= upper {
            Decision::H1
        } else {
            Decision::Continue
        };
        SprtStatus {
            n,
            mean,
            llr,
            lower,
            upper,
            elo,
            decision,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sprt() -> Sprt {
        Sprt {
            elo0: 0.0,
            elo1: 10.0,
            alpha: 0.05,
            beta: 0.05,
        }
    }

    #[test]
    fn bounds() {
        let (l, u) = sprt().bounds();
        assert!((l + 2.944).abs() < 1e-3 && (u - 2.944).abs() < 1e-3);
    }

    #[test]
    fn clear_improvement_accepts_h1() {
        let samples: Vec<f64> = (0..400)
            .map(|i| if i % 10 < 7 { 0.75 } else { 0.25 })
            .collect();
        assert_eq!(sprt().status(&samples).decision, Decision::H1);
    }

    #[test]
    fn regression_accepts_h0() {
        let samples: Vec<f64> = (0..400)
            .map(|i| if i % 10 < 4 { 0.75 } else { 0.25 })
            .collect();
        assert_eq!(sprt().status(&samples).decision, Decision::H0);
    }

    #[test]
    fn few_samples_continue() {
        assert_eq!(sprt().status(&[0.6, 0.4]).decision, Decision::Continue);
        assert_eq!(sprt().status(&[]).decision, Decision::Continue);
    }
}
