# Beyond Fixed Context: A Retention-Aware Attention Variant

**Authors:** Chen, L.; Okafor, S.; Bianchi, R. (2024)
**Venue:** Preprint (arXiv:2409.10321), not yet peer-reviewed

## Abstract

We introduce **RA-Attn** (retention-aware attention), a modification to
scaled dot-product attention in which each token maintains a scalar
*retention factor* that decays with distance and is fine-tuned during
training. On a 2B-parameter decoder-only model trained on 240B tokens
of the CommonCrawl-derived C4 corpus, RA-Attn improved long-context
recall on the Needle-in-a-Haystack benchmark by **6.4 points at 32k
context** and reduced repetition-loop failures on open-ended generation
by 41%. It did not improve short-context (≤2k) quality.

## 1. Motivation

Vanilla attention gives every previous token equal weight in principle,
but empirically models learn to focus on a narrow window and behave
poorly when relevant information is far away. Prior work (Beltagy et
al., 2020; Ainslie et al., 2023) addressed this with sparse attention
or per-head windowed patterns; RA-Attn instead uses a learned per-token
scalar that lets the model choose where to look based on content.

## 2. Method

For each key-value pair `(k_i, v_i)` at position `i`, we learn a scalar
`r_i ∈ [0, 1]` initialized to 1 and updated by a small MLP over the
key. The attention weight becomes:

    a_ij = softmax_j( q_i · k_j / sqrt(d) + log(r_j) )

`log(r_j)` is 0 when `r_j = 1` (default retention) and negative when
the model chooses to demote a token. There is no positional prior in
`r`; the model must learn where to focus purely from content signal.

## 3. Experimental setup

- **Base model.** A 2B-parameter decoder-only transformer, 32 layers,
  32 heads, 2048 hidden. Rotary positional embeddings.
- **Data.** C4 filtered to English, 240B tokens.
- **Compute.** 512 A100-40GB for 22 days. Total compute ~4.9e21 FLOPs.
- **Baselines.** Same architecture with vanilla attention; same
  architecture with sliding-window attention (window=4096).

## 4. Results

| Benchmark                     | Vanilla | Sliding | RA-Attn |
|-------------------------------|---------|---------|---------|
| Needle-in-a-Haystack @32k     | 71.2    | 72.9    | **77.6**|
| LongBench (avg)               | 44.3    | 45.0    | **48.1**|
| MMLU (5-shot)                 | 51.8    | 51.6    | 51.9    |
| HellaSwag                     | 66.4    | 66.2    | 66.5    |
| Repetition failure rate (gen) | 8.1%    | 6.7%    | **4.8%**|

Short-context tasks (MMLU, HellaSwag) show no significant delta,
confirming the mechanism is genuinely long-context specific.

## 5. Limitations

- We only tested a single model size. Whether the effect scales with
  parameter count is an open question.
- Training compute is 1.2× vanilla per step due to the extra MLP.
  The paper does not include a compute-matched comparison, which we
  note as a fair criticism.
- The learned retention factors are not interpretable in the way
  attention weights are; we have no obvious way to inspect *why* the
  model demoted a token.

## 6. Related work

Longformer (Beltagy et al., 2020) uses fixed windowed attention with
global attention on special tokens. RA-Attn's retention factor is
learned per-token instead of designed per-head. GateLoop (Katharopoulos
et al., 2023) applies a gating mechanism inside a recurrent formulation;
RA-Attn instead retains the standard attention operator and modifies
the pre-softmax logits.

## 7. Conclusion

RA-Attn is a small architectural change with a measurable long-context
benefit and no short-context regression. We release checkpoints at
huggingface.co/chen-okafor/ra-attn-2b under the Apache 2.0 license.
Weights for larger variants (7B, 13B) are not currently planned.
