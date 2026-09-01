/**
 * The binding customer agreement — one source of truth.
 *
 * `/legal/terms` renders this text directly and the application form scrolls it to the bottom
 * before revealing the signature field, so the published page and the accepted agreement cannot
 * drift apart. Keep it that way: a second copy of terms is a second set of terms.
 *
 * ── VERSIONING IS NOT COSMETIC ───────────────────────────────────────────────────────────────
 * `applications.terms_version` records the version each applicant actually accepted, alongside
 * `terms_accepted_at`. **Never backfill it.** Somebody who accepted v3 is bound by v3 until they
 * accept a newer version through the notice process in §22 — rewriting the stored version would
 * destroy the evidence of what they agreed to, which is the whole point of storing it.
 *
 * Bump `TERMS_VERSION` whenever the TEXT changes materially. Typo fixes do not need a bump; a
 * changed obligation always does.
 *
 * ⚠️ Reviewed 2026-09-01 — findings, rationale for every added section, and the pre-launch
 * checklist are in **docs/TERMS_REVIEW_2026-09-01.md**. That review was written by an engineer
 * reading the code, NOT by a lawyer, and it says so: this document should not bind a customer
 * until Ohio counsel has reviewed it.
 */
export const TERMS_VERSION = 'v4-2026-09-platform';

export const TERMS_TEXT = `RFP PIPELINE, INC. — TERMS & CONDITIONS
Founding Cohort Agreement
Effective Date: Upon acceptance of your application

1. PLATFORM DESCRIPTION
RFP Pipeline ("the Platform," "we," "us") is a software platform and tooling provider offering AI-acceleration, document management, and expert-curated opportunity tools for small businesses pursuing federal research and development funding. The Platform provides AI-assisted proposal drafting, compliance matrix curation, opportunity matching, and document management tools. RFP Pipeline is a platform — not a proposal writer, not a government contracting advisor, and not a guarantor of any outcome. Our software and our people can and do make mistakes; the Platform, its AI, and its human experts produce drafts, suggestions, and support only.

2. AUTHORIZED REPRESENTATIVE CERTIFICATION
By submitting this application, you certify that:
(a) You are an authorized representative of the company named in this application with the legal authority to bind the company to these terms;
(b) You are at least 18 years of age;
(c) The information you provide is accurate and complete;
(d) You will serve as the primary administrator for your company's workspace.

3. YOUR FINAL REVIEW RESPONSIBILITY
(a) Final review, verification, and submission of any materials is ALWAYS your responsibility. You are the final quality gate before anything is submitted to any federal agency or third party.
(b) The Platform, its AI features, and any curation, review, or consultation performed by RFP Pipeline staff produce drafts, suggestions, and support — never final, submission-ready deliverables. Nothing the Platform or our staff produces is a substitute for your own independent review.
(c) We make mistakes. AI output can be inaccurate or fabricated, opportunity data can be incomplete or stale, and human reviewers can err. You agree to independently verify all content, requirements, deadlines, page limits, and compliance items before relying on or submitting them.
(d) RFP Pipeline is not a legal, financial, or government-contracting advisory service. Consult qualified professionals for such advice.

4. ADMINISTRATOR & USER-ACCESS RESPONSIBILITY
User access is always the responsibility of the customer administrator. As the designated administrator, you are solely responsible for:
(a) All users, employees, and collaborators you invite to or grant access to your company workspace, and everything they do with that access;
(b) Setting, reviewing, and revoking each user's and collaborator's access to the minimum necessary for their role, and revoking it promptly when it is no longer needed;
(c) The accuracy, legality, and appropriateness of all content uploaded to the Platform;
(d) Ensuring that any team members or partners you add understand and comply with these terms;
(e) Maintaining the confidentiality of your account credentials.
RFP Pipeline is not responsible for access you grant, fail to revoke, or misconfigure.

5. DATA, CONTENT, AND AI OUTPUT
(a) You retain ownership of all content you upload to the Platform ("Your Content").
(b) You grant RFP Pipeline a limited, non-exclusive license to process, store, analyze, and use Your Content solely for the purpose of providing Platform services to you.
(c) AI-generated content produced by the Platform is provided as drafts for your review. You are solely responsible for reviewing, editing, accepting, and submitting any materials derived from AI assistance.
(d) RFP Pipeline does not claim ownership of AI-generated content produced for your use.
(e) NO TRAINING ON YOUR CONTENT. RFP Pipeline does not use Your Content to train, fine-tune, or otherwise improve any generative AI model, and contracts with its AI providers on terms that prohibit them from doing so. This commitment survives termination.
(f) AI output carries risks you accept as the submitting party. Material generated by artificial intelligence may not be eligible for copyright protection, may resemble or coincide with material created by others, and may require substantial revision to be accurate or usable. You are responsible for ensuring that anything you submit is original where originality is required, is accurate, and does not infringe any third party's rights.

6. EXPERT CURATION & RFP-PIPELINE OVERSIGHT (SHADOW ACCESS)
(a) Auto opt-in. By default, RFP Pipeline expert staff ("RFP-Pipeline Admins") are granted oversight access to your proposal portals to provide curation, quality review, compliance setup, and support ("RFP-Pipeline Oversight"). This access is enabled automatically for each proposal portal you purchase, and it is how we curate, release, and support your build.
(b) What it is used for. RFP-Pipeline Oversight is used to prepare and release your proposal portal, review and improve compliance and drafting, respond to support requests, and provide the escalations and nudges that keep a build on schedule. RFP-Pipeline Admins act on your behalf within your workspace; their work remains advisory and is subject to Section 3.
(c) Opting out. You may decline RFP-Pipeline Oversight for any proposal portal at any time through that portal's guardrail settings.
(d) Effects of opting out. If you opt out of RFP-Pipeline Oversight for a portal, RFP Pipeline will not provide expert curation, backstop review, or oversight nudges for that portal, and you will not receive the benefit of our review on it. All responsibility for review, compliance, quality, and deadlines for that portal rests solely with you. Opting out does not reduce your fees and does not create any RFP Pipeline obligation to monitor that portal.

7. EXPERT CONSULTATION TIME
(a) Eligible customers accrue up to fifteen (15) minutes of expert consultation time per month ("Expert Time"), schedulable through the Platform's calendar against an RFP-Pipeline Admin's posted availability, up to your accrued balance.
(b) Expert Time is advisory only. It does not transfer any responsibility or liability to RFP Pipeline, does not guarantee any outcome, and is subject to Sections 3, 8, and 16.
(c) Expert Time is subject to availability and scheduling. Accrual amounts, rollover, and eligibility may change on notice; unless expressly stated, unused Expert Time does not roll over.
(d) Automated video-meeting scheduling (e.g., calendar-linked video links) may be offered as the feature matures; its availability is not guaranteed and is not a condition of these terms.

8. NO GUARANTEES OR WARRANTIES
(a) THE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, OR NON-INFRINGEMENT.
(b) RFP Pipeline does not guarantee any specific outcomes, including but not limited to: proposal wins, funding awards, compliance accuracy, or scoring results.
(c) RFP Pipeline does not guarantee the accuracy, completeness, or timeliness of opportunity data sourced from federal or third-party databases (DSIP, SAM.gov, SBIR.gov, Grants.gov, etc.).
(d) No warranty applies to any curation, review, consultation, drafting assistance, or oversight performed by the Platform or by RFP-Pipeline Admins; all of it is advisory and subject to your final review under Section 3.
(e) You are solely responsible for reviewing and verifying all materials before submission to any federal agency.
(f) RFP Pipeline makes no representation that any material produced with the Platform complies with the Federal Acquisition Regulation, the Defense Federal Acquisition Regulation Supplement, any agency-specific solicitation instruction, or any eligibility requirement, and no representation that any agency will accept a submission. Determining eligibility, responsiveness, and compliance is yours.
(g) The Platform is not offered with any uptime commitment or service-level agreement. Availability, features, and AI model selection may change without notice.

9. PRICING AND PAYMENT
(a) Founding Cohort Spotlight subscription: $499/month.
(b) Proposal Portal purchases: priced per portal at the rates in effect at time of purchase.
(c) Payment is due on the day of onboarding for the first month and on the same day of each subsequent month.
(d) Pricing may change at any time, but customers will be given at least 30 days' written notice prior to any price change.
(e) You may cancel your subscription at any time. Cancellation is effective at the end of the current paid period. No pro-rata refunds will be issued for partial months.
(f) PROPOSAL PORTAL PURCHASES ARE NON-REFUNDABLE ONCE AI DRAFTING HAS BEEN INITIATED.

10. YOUR CONTENT: WHAT YOU MAY NOT UPLOAD
(a) You are responsible for the legality of everything placed in your workspace, including content uploaded by users and collaborators you have granted access.
(b) You may not upload classified information of any kind.
(c) CONTROLLED TECHNICAL DATA. You may not upload, transmit, or store on the Platform any technical data or defense article subject to the International Traffic in Arms Regulations (ITAR, 22 C.F.R. §§ 120–130), any item controlled under the Export Administration Regulations (EAR) requiring a license for release to a foreign person, or any Controlled Unclassified Information (CUI) requiring safeguarding beyond that described in Section 12. The Platform is not certified, accredited, or represented as compliant with ITAR, DFARS 252.204-7012, NIST SP 800-171, FedRAMP, or CMMC at any level.
(d) You represent and warrant on each upload that the content does not fall within Section 10(c), and you will indemnify RFP Pipeline under Section 15 for any claim arising from content that does.
(e) You may not upload malicious code, content that infringes a third party's rights, or content whose processing would violate applicable law.
(f) If you become aware that controlled or classified material has been placed in your workspace, you must notify us immediately at eric@rfppipeline.com so it can be removed.

11. CONFIDENTIALITY
(a) "Confidential Information" means non-public information disclosed by either party that is marked confidential or that a reasonable person would understand to be confidential given its nature. Your Content is your Confidential Information. The Platform's non-public software, methods, and pricing are ours.
(b) Each party will use the other's Confidential Information only to perform under these terms, will protect it with at least the care it uses for its own confidential information of like kind (and never less than reasonable care), and will not disclose it to third parties except to employees, contractors, and subprocessors bound by confidentiality obligations at least as protective as these.
(c) Confidential Information does not include information that is or becomes public without breach, was known without obligation before disclosure, is independently developed without use of the other party's Confidential Information, or is rightfully received from a third party without restriction.
(d) A party compelled by law to disclose Confidential Information may do so, and will give the other party prompt notice where legally permitted so that party may seek protection.
(e) This Section survives termination for three (3) years, and indefinitely as to any trade secret.

12. DATA SECURITY
(a) RFP Pipeline implements industry-standard security measures to protect Your Content, including encryption at rest and in transit, role-based access controls, and tenant isolation.
(b) However, no system is 100% secure. RFP Pipeline cannot guarantee that Your Content will never be subject to unauthorized access, breach, or loss.
(c) You acknowledge this risk and agree that RFP Pipeline's liability for data security incidents is limited as set forth in Section 16.
(d) In the event of a data breach affecting Your Content, RFP Pipeline will notify you without undue delay and in any event within seventy-two (72) hours of confirming the breach.
(e) A current list of the third-party subprocessors that may process Your Content is published at rfppipeline.com/legal/privacy. We will update that list before engaging a new subprocessor that processes Your Content.

13. CANCELLATION AND TERMINATION
(a) You may cancel your subscription at any time by contacting eric@rfppipeline.com.
(b) Upon cancellation, your access continues until the end of the current paid period.
(c) After the paid period ends, your workspace will be placed in read-only mode for 30 days. During this period you may export your data.
(d) After the 30-day read-only period, your data may be permanently deleted.
(e) RFP Pipeline reserves the right to terminate your account for violation of these terms, with 30 days' notice except in cases of egregious violations, which include any breach of Section 10.

14. INTELLECTUAL PROPERTY
(a) RFP Pipeline retains all rights to the Platform, including its software, AI models, curation processes, and proprietary methods.
(b) De-identified, aggregated insights derived from platform usage may be used to improve the service for all customers. This permits statistics about how the Platform is used; it does not permit use of Your Content, or of anything derived from Your Content that could reasonably be attributed to you or reconstructed into your material, and it does not permit model training under any circumstances (Section 5(e)). No individual customer data will be shared or identifiable.

15. INDEMNIFICATION
You agree to indemnify, defend, and hold harmless RFP Pipeline, its officers, directors, employees, and agents from any claims, damages, losses, or expenses (including reasonable attorneys' fees) arising from: (a) your use of the Platform, (b) your violation of these terms, (c) your violation of any applicable law, (d) any content you upload to the Platform, including any breach of Section 10, or (e) any material you submit to a federal agency or third party, whether or not it was prepared with the assistance of the Platform or RFP-Pipeline staff.

16. LIMITATION OF LIABILITY
(a) TO THE MAXIMUM EXTENT PERMITTED BY LAW, RFP PIPELINE SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, BUSINESS OPPORTUNITIES, OR GOODWILL, ARISING OUT OF OR RELATED TO YOUR USE OF THE PLATFORM OR ANY CURATION, REVIEW, CONSULTATION, OR OVERSIGHT PERFORMED BY RFP-PIPELINE STAFF, REGARDLESS OF WHETHER SUCH DAMAGES WERE FORESEEABLE OR WHETHER RFP PIPELINE WAS ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
(b) RFP PIPELINE'S TOTAL AGGREGATE LIABILITY SHALL NOT EXCEED THE AMOUNTS YOU PAID TO RFP PIPELINE IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.
(c) The exclusions and limits in (a) and (b) do not apply to: liability for death or personal injury caused by negligence; fraud or fraudulent misrepresentation; gross negligence or wilful misconduct; your payment obligations; your indemnification obligations under Section 15; or any liability that cannot lawfully be limited.
(d) The limits in this Section apply even if a limited remedy is found to have failed of its essential purpose, and reflect an agreed allocation of risk that is a fundamental basis of the pricing in Section 9.

17. GOVERNING LAW
These terms are governed by the laws of the State of Ohio, without regard to its conflict-of-laws rules. The United Nations Convention on Contracts for the International Sale of Goods does not apply.

18. EXPORT CONTROL AND SANCTIONS
You represent that you are not located in, organized under the laws of, or ordinarily resident in any country or region subject to comprehensive U.S. sanctions, and that you are not identified on any U.S. government restricted-party list. You will not permit access to the Platform from any such country or by any such person, and will comply with all applicable export control and sanctions laws.

19. U.S. GOVERNMENT RIGHTS
The Platform is "commercial computer software" and "commercial computer software documentation" as those terms are used in FAR 12.212 and DFARS 227.7202. Any use, duplication, or disclosure by the U.S. Government is subject solely to the rights in these terms. Nothing here grants the U.S. Government rights in the Platform beyond those in this Section, and nothing here is intended to make RFP Pipeline a subcontractor to, or to place it in privity with, any government contract you may hold.

20. FORCE MAJEURE
Neither party is liable for a failure or delay in performance (other than a payment obligation) caused by events beyond its reasonable control, including acts of God, war, terrorism, civil unrest, labor conditions, governmental action, internet or utility failure, and failure or degradation of a third-party provider on which the Platform depends. The affected party will use reasonable efforts to resume performance.

21. DISPUTE RESOLUTION
(a) Informal resolution first. Before filing a claim, you agree to contact eric@rfppipeline.com and attempt to resolve the dispute informally for at least thirty (30) days.
(b) Binding arbitration. Any dispute not resolved informally will be settled by binding arbitration administered by the American Arbitration Association under its Commercial Arbitration Rules, conducted in Ohio. Each party bears its own attorneys' fees.
(c) CLASS ACTION WAIVER. YOU AND RFP PIPELINE EACH WAIVE ANY RIGHT TO BRING OR PARTICIPATE IN A CLASS, COLLECTIVE, OR REPRESENTATIVE ACTION. The arbitrator may not consolidate the claims of more than one party or preside over any form of representative proceeding. If this subsection is found unenforceable, the entirety of Section 21(b) is void and disputes will be resolved in the state or federal courts located in Ohio.
(d) Carve-outs. Either party may bring an individual claim in small-claims court, and either party may seek injunctive or other equitable relief in a court of competent jurisdiction to protect its intellectual property or Confidential Information.
(e) Opt-out. You may opt out of Section 21(b) and 21(c) by emailing eric@rfppipeline.com with the subject line "Arbitration Opt-Out" within thirty (30) days of first accepting these terms. Opting out affects no other part of this agreement.

22. MODIFICATIONS
(a) RFP Pipeline may modify these terms. Material changes will be communicated by email to your administrator at least 30 days before taking effect, and the current version is always published at rfppipeline.com/legal/terms.
(b) If you object to a material change, you may terminate your subscription without penalty before the change takes effect, and receive a pro-rata refund of any prepaid, unused fees for the then-current period. That right is your exclusive remedy for a change you do not accept.
(c) Continued use of the Platform after the effective date constitutes acceptance of the modified terms.

23. SEVERABILITY
If any provision is held unenforceable, it will be modified to the minimum extent necessary to make it enforceable, or if it cannot be, severed; the remaining provisions stay in full force. Section 21(c) is an exception, governed by its own terms.

24. SURVIVAL
Sections 3, 5, 8, 10, 11, 14, 15, 16, 17, 18, 19, 21, 23, 24, 25, 26, 27, 28, and 29 survive termination or expiration.

25. ASSIGNMENT
You may not assign these terms without our prior written consent, except to a successor in a merger or sale of substantially all assets that is not a competitor of RFP Pipeline. We may assign these terms in connection with a merger, acquisition, or sale of assets. Any prohibited assignment is void.

26. NOTICES
Notices to you may be sent to the administrator email on your account and are effective when sent. Notices to RFP Pipeline must be sent to eric@rfppipeline.com and are effective on receipt. You are responsible for keeping your administrator email current.

27. NO WAIVER
A failure to enforce any provision is not a waiver of it or of any other provision. A waiver is effective only if in writing.

28. NO THIRD-PARTY BENEFICIARIES
These terms create no rights in any person other than you and RFP Pipeline. Nothing here gives any federal agency, teaming partner, subcontractor, or other third party a right to enforce any provision.

29. ENTIRE AGREEMENT
These Terms & Conditions, together with the Privacy Policy, Acceptable Use Policy, and AI Disclosure published at rfppipeline.com/legal, constitute the entire agreement between you and RFP Pipeline regarding use of the Platform and supersede any prior agreements or understandings. In the event of a conflict, these Terms & Conditions control.`;
