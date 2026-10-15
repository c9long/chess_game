> **[DRAFT — for attorney review before publication. Not yet in effect. Bracketed text in ALL CAPS is a placeholder to fill in. Bracketed "Drafting note" paragraphs are for the reviewing attorney and must be deleted before publication. See the "Notes for reviewing attorney" at the end for the open decisions.]**

# Terms of Service

**[GAME NAME]** (working title: "LinkedLists's Chess Game")

- **Version:** v0.2 (draft)
- **Effective date:** [EFFECTIVE DATE]
- **Last updated:** [EFFECTIVE DATE]

> [Drafting note: The display name comes from the `APP_NAME` constant. If the title changes before launch, replace it here and in the Privacy Policy. Each published version must get a new version number, because acceptances are stored per version in `legal_acceptances`. v0.2 removes the former Section 17 (Time limit for claims), so Sections 17–22 are renumbered from v0.1.]

---

**[OPTION A ONLY — keep this box if Option A (Arbitration) is chosen; delete it if Option B is chosen:]**

> **IMPORTANT NOTICE ABOUT DISPUTES. SECTION 18 CONTAINS AN ARBITRATION AGREEMENT AND A CLASS-ACTION WAIVER. UNLESS YOU OPT OUT WITHIN 30 DAYS AS DESCRIBED IN SECTION 18.7, MOST DISPUTES BETWEEN YOU AND US WILL BE RESOLVED BY BINDING INDIVIDUAL ARBITRATION, NOT IN COURT, AND YOU GIVE UP THE RIGHT TO A JURY TRIAL AND TO TAKE PART IN A CLASS ACTION.**

---

## 1. Who we are and what these Terms cover

These Terms of Service ("**Terms**") are a binding agreement between you and **[OPERATOR LEGAL NAME]**, a [STATE] [ENTITY TYPE, e.g. limited liability company] ("**we**", "**us**", "**our**").

They govern your use of the Game, which includes:

- the website and web game at `play.[DOMAIN]` and the related servers at `api.[DOMAIN]`;
- any downloadable client we release, including a future PC client distributed through Steam;
- our bots, lobbies, ratings, match history and any other features we offer; and
- emails and other communications we send about the Game.

Together these are the "**Service**."

Our **Privacy Policy** at `play.[DOMAIN]/privacy` explains how we handle personal information. Please read it. It describes our practices but is not part of this contract.

## 2. Accepting these Terms

You accept these Terms by checking the box next to "I agree to the Terms of Service" (with links to these Terms and our Privacy Policy) before you create an account by any method (email, Google, Discord, GitHub, Microsoft, passkey, or Steam), before you first play as a guest, or before you first sign in through any downloadable client. We will not create an account or start a game until you do. If you do not agree, do not use the Service.

We record which version of these Terms you accepted and when.

**If you are under 18** (or under the age of majority where you live), you must have your parent or legal guardian's permission to use the Service. See Section 3.2.

> [Drafting note: PLAN §7 originally let the Steam/Unity client and the website "Sign in / link with Steam" and device-code flows create or attach accounts without a checkbox, and one-click OAuth buttons can create a user before any checkbox is shown. The product must (1) keep every OAuth/passkey/Steam button disabled until the box is checked, (2) show the same unchecked checkbox on Steam/Unity first launch and in the device-code flow, and (3) write a `legal_acceptances` row in each case (tracked in TODO.md). Without this, users who arrive through those paths have no clickwrap record (*Specht*; *Berman*; *Meyer*).
>
> OPTION A ONLY — show this line directly beneath the checkbox: "These Terms include an arbitration agreement and class-action waiver (Section 18), which you can opt out of within 30 days."]

## 3. Who can use the Service

### 3.1 Minimum age: 13

You must be **at least 13 years old** to use the Service, as a guest or with an account. When you first visit, we ask for your date of birth. We do not store your birth date. We keep only your age band (13–15, 16–17 or 18+) and the date you confirmed it.

If we learn that a user is under 13, we will delete that user's account and personal information promptly, as described in our Privacy Policy. Parents who believe their child under 13 is using the Service can contact us at [PRIVACY CONTACT EMAIL].

### 3.2 Users under 18

If you are at least 13 but under 18 (or under the age of majority where you live), you may use the Service only with the permission of a parent or legal guardian.

If you are under 18, you confirm that a parent or legal guardian has reviewed these Terms with you and permits your use. We encourage parents to review these Terms and our Privacy Policy.

> [Drafting note — guardian language, choose one:
>
> **(b) As drafted (no guardian step).** The Service collects no guardian identity and has no guardian action, so the Terms bind only the minor and do not purport to bind the parent. A parent cannot be bound merely by "allowing" use (no manifestation of assent; *Berman v. Freedom Financial*, 9th Cir. 2022). The minor may disaffirm before majority or within a reasonable time after (Cal. Fam. Code §§ 6700, 6710).
>
> **(a) Guardian step.** If the operator adds a step for users in the 13–15 and 16–17 bands that collects a guardian email and has the guardian click "I am the parent/guardian and agree to the Terms on my own behalf and for my child" (recorded in `legal_acceptances` with `document='guardian'`), replace the second paragraph of this Section with: "**To parents and guardians:** by confirming your agreement when we ask you to, you agree to these Terms on your child's behalf and on your own behalf, and you are responsible for your child's use of the Service." The parental indemnity sentence formerly in Section 15 may then be restored.
>
> Under either choice, a minor's disaffirmance can defeat the arbitration clause, including its delegation provision: *R.A. v. Epic Games* (C.D. Cal. 2019); *Doe v. Epic Games*, 435 F. Supp. 3d 1024 (N.D. Cal. 2020); *J.R. v. Electronic Arts* (Cal. Ct. App. Jan. 17, 2024, E080414). Federal courts have since diverged where the minor disaffirms "all contracts" without specifically attacking the delegation clause (e.g., *Huie v. Epic Games*; *Williams v. Moon Active* (N.D. Cal. Dec. 9, 2025)). Counsel to confirm current status.]

### 3.3 Other eligibility requirements

You may not use the Service if:

- we have previously banned you or terminated your account, unless we have agreed in writing that you may return;
- you are located in a country subject to a comprehensive US government embargo, or you are on a US government list of prohibited or restricted parties;
- [ONLY IF THE OPERATOR DECIDES NOT TO SERVE THE EEA/UK (see the Privacy Policy, Section 11.3): you are located in the European Economic Area, the United Kingdom or Switzerland;] or
- using the Service would violate any law that applies to you.

## 4. Accounts and guest play

### 4.1 Ways to play

You can play in two ways:

- **As a guest.** We create a temporary guest account for you (for example, "Guest-4821"). No email or password is needed.
- **With a registered account.** You sign up with an email address, username and password, or sign in through a supported provider (currently Google, Discord, GitHub or Microsoft, and in the future Steam).

### 4.2 Guest accounts

Guest accounts are temporary and are tied to your browser or device.

- **Guests can play casual games only.** Rated games require four registered players (Section 7).
- **Guest accounts expire.** If a guest account is inactive for 30 days, we purge it. Guest accounts without matches are deleted. For guest accounts with matches, we delete the guest's identifying details and keep the games under a placeholder name so the other players' match history stays intact (see the Privacy Policy, Section 8).
- **If you clear your browser data, lose your device, or switch browsers, you may lose access to your guest account permanently.** We cannot recover it.
- **You can upgrade a guest account** to a registered account at any time before it expires. Your match history and other progress carry over.

### 4.3 Registered accounts

When you register, you agree to:

- give accurate information, including a working email address you control, and keep it up to date;
- keep your account to yourself. **One person per account.** Do not share, sell, rent, lend or transfer your account or let anyone else play on it;
- not create an account if we have banned you, and not create accounts to get around a suspension, a rating, or a restriction (see Section 6).

You may have more than one account only if we expressly allow it (for example, a separate account linked to a future Steam client before you merge it). You may not use multiple accounts to manipulate ratings or matches.

### 4.4 Keeping your account secure

You are responsible for activity on your account and for keeping your sign-in methods secure. That includes your password, any passkey, your authenticator app and backup codes for two-step verification, and the accounts you use to sign in with Google, Discord, GitHub, Microsoft or Steam.

We strongly recommend turning on a passkey or two-step verification (TOTP). Store your backup codes somewhere safe. **If you lose all of your sign-in methods and backup codes, we may not be able to restore access** to your account, because we must be careful not to hand your account to someone else.

Tell us right away at [SECURITY CONTACT EMAIL] if you think someone has accessed your account without permission.

We will never ask for your password by email, chat or any other channel.

### 4.5 Third-party sign-in

If you sign in through Google, Discord, GitHub, Microsoft, Steam or another provider, your use of that provider is governed by its own terms and privacy policy. We are not responsible for those providers. If you lose access to your account with that provider, you may lose access to your account with us unless you have set up another sign-in method.

### 4.6 Usernames

Your username is public. It appears in lobbies, during games, on results screens, in match history and on ratings displays. Your username must not:

- impersonate another person, a public figure, a streamer or content creator, a brand, or us (including names suggesting you are a moderator, admin or staff member);
- contain hate speech, slurs, sexual or obscene content, threats, or references to violent extremist groups;
- harass, mock or target another person;
- include personal information (yours or anyone else's), such as a real full name you don't want public, phone number, address or social media handle used to solicit contact;
- advertise, promote a commercial service, or link to a website; or
- infringe someone else's trademark or other rights.

The same rules apply to **lobby names** and to any other text you create in the Service.

We may refuse, reset or change any username or lobby name that we believe breaks these rules, and we may reserve certain names. We may replace a removed username with a neutral placeholder.

> [Drafting note: The username-change policy (whether users can change usernames, how often, and whether old names are reserved) is still an open product decision (TODO "moderation"). Add a sentence here once decided.]

## 5. Your license to use the Service

Subject to these Terms, we give you a personal, limited, non-exclusive, non-transferable, non-sublicensable, revocable license to access and use the Service for your own personal, non-commercial entertainment.

If we release a downloadable client, this license lets you install and run it on devices you own or control, for the same purpose. A client obtained through Steam is also subject to the Steam Subscriber Agreement. If those terms conflict with these Terms on a point between you and Valve, Valve's terms control that point; as between you and us, these Terms control.

Streaming and recording: you may stream, record and share videos and screenshots of your own gameplay, including on monetized channels, as long as you do not suggest we sponsor or endorse you, you do not break these Terms while doing so (for example, by sharing a private lobby's password without the host's permission, or by encouraging viewers to harass other players), and you stop if we reasonably ask you to. We may change this permission at any time.

## 6. Rules of conduct (acceptable use)

We want every game to be fair and every player to feel welcome. You agree **not** to do any of the following.

### 6.1 Cheating and fair play

- **Get outside help during a game.** This includes using any chess engine, analysis tool, our own bots, a "board copier," a browser extension, an overlay, or another person to suggest moves or evaluate positions **while a rated game is in progress**. In casual games, outside help is allowed only if every other human in the game has agreed to it.
- **Collude in free-for-all games.** In Free-for-All mode, do not secretly team up with another player, agree in advance or during the game to spare or target particular players, or share information with another player in the same game through any outside channel. Normal in-game play (for example, choosing on your own whom to attack) is fine. In Teams mode, coordinating with your own teammate is allowed.
- **Manipulate ratings.** This includes deliberately losing ("sandbagging" or "tanking"), arranging results ("win trading"), playing on someone else's account to raise or lower its rating ("boosting"), using multiple accounts in the same game, or filling rated lobbies with accounts you control.
- **Abuse disconnects or the clock.** Do not deliberately disconnect, stall, abandon games, or interfere with another player's connection to gain an advantage or to avoid a loss.
- **Exploit bugs.** If you find a bug that gives an unfair advantage or affects ratings, report it to us at [CONTACT EMAIL] and do not use it or share it with others.
- **Use automation.** Do not use scripts, bots, macros or automated tools to play, join lobbies, create accounts or interact with the Service, except our own bots offered in the game.

### 6.2 Respect for other players

- **No harassment.** Do not harass, bully, threaten, stalk, intimidate or abuse anyone, inside or outside the game, because of their play in the Service.
- **No hate.** Do not attack anyone based on race, ethnicity, national origin, religion, caste, sex, gender identity, sexual orientation, disability, age, serious illness, or other protected characteristic. The civilizations in the Game are cosmetic; do not use them to target players or real-world groups.
- **No sexual content involving minors**, ever. We report apparent child sexual exploitation to the National Center for Missing & Exploited Children (NCMEC) and to law enforcement.
- **No doxxing.** Do not post or threaten to post someone's personal information.
- **No impersonation** of other players, public figures, or our staff.
- **No spam, scams or phishing**, including attempts to get other players' passwords, backup codes or account access.
- **No offensive usernames or lobby names** (see Section 4.6).

### 6.3 Protecting the Service

- **Do not attack the Service.** Do not probe, scan or test the vulnerability of the Service without our written permission; overload it (for example, denial-of-service attacks); or bypass our security measures, rate limits, CAPTCHA (Cloudflare Turnstile), or lobby passwords.
- **Do not guess lobby passwords** or try to join password-protected lobbies without being given the password.
- **Do not access accounts or data that aren't yours.**
- **Do not reverse engineer** the Service, the game server, or its network protocol, except to the extent applicable law expressly permits it despite this restriction. You may not build or distribute unofficial clients, cheat tools, or modified clients that connect to our servers.
- **Do not scrape** or harvest data from the Service (including usernames, ratings or match history) by automated means, except through an official API we publish for that purpose and in line with its terms.
- **Do not resell or commercially exploit** the Service, accounts, ratings or game access.
- **Do not break the law** or encourage anyone else to.

### 6.4 Security researchers

If you believe you have found a security vulnerability, please report it to [SECURITY CONTACT EMAIL] and give us a reasonable time to fix it before disclosing it. We will not pursue claims against good-faith research that follows these steps, avoids privacy violations and service disruption, and does not access or change other users' data beyond what is needed to show the issue.

> [Drafting note: The safe-harbor sentence is optional. It is a goodwill measure that encourages responsible disclosure; counsel may narrow it or delete it.]

## 7. Rated play and ratings

### 7.1 How rated play works

- A game is **rated** only if all four seats are filled by **registered human players**. Any game with a bot or a guest is **casual**.
- Ratings are calculated from your finishing place in each game. We track separate ratings for each mode and time control (for example, Free-for-All 10+0 and Teams 3+2).
- We use a statistical rating system (currently OpenSkill) and display the result as an Elo-like number. **Bot strength labels are approximate** and are not a rating guarantee.
- We may use a hidden internal rating, updated in casual games against bots, solely to calibrate bot strength. It does not affect your public rating.
- **Games that end because of a server problem** (for example, a server restart) are recorded as aborted and are unrated.

### 7.2 Our right to adjust or reset ratings

Ratings exist for fun and fair matchmaking. **They are not property and have no monetary value.** We may, at any time and in our reasonable discretion:

- change the rating system, its parameters, or how ratings are displayed;
- recalculate, adjust, or roll back ratings, including after detecting a bug, cheating, collusion or other rule violation;
- void or annul game results, including results against a player later found to have cheated;
- reset ratings for some or all players, modes or time controls (for example, at the start of a new season or after a rules change); and
- remove ratings or results from public display.

We will try to announce broad resets in advance, but we are not required to.

### 7.3 Fair-play review

We may use automated tools and human review to detect cheating, collusion and rating manipulation. To protect these systems, we may not explain exactly how they work or what triggered a decision.

## 8. Moderation, suspension and termination

### 8.1 What we may do

To keep the Service fair and safe, we may, with or without notice:

- remove or change usernames, lobby names or other content;
- remove a player from a lobby or game, or close a lobby;
- annul results and adjust ratings (Section 7.2);
- restrict features (for example, rated play) for a period of time;
- suspend your account temporarily; or
- permanently ban you and terminate your account.

We decide what action to take based on how serious the violation is, any history of violations, and the effect on other players. We do not have to give a warning first. We may also act against related accounts used by the same person. The Privacy Policy describes the signals we use to identify related accounts.

We may also suspend or end the Service, or your access to it, if we are required to by law, if your account has been inactive for a long period, or if continuing to provide it to you is no longer commercially or technically practical.

### 8.2 Appeals

If you think we made a mistake, email [CONTACT EMAIL] from the address on your account within 30 days of the action, with your username and an explanation. We will review it and respond, but our decision after review is final.

### 8.3 Deleting your account

You may delete your account at any time in **Settings**. Deletion takes effect immediately and **cannot be undone**:

- your email address and username are replaced with a placeholder (for example, "Deleted player #1234");
- your passwords, passkeys, sessions, two-step verification secrets and linked sign-in accounts are deleted;
- your past games remain in other players' match histories under the placeholder name, so their records and ratings stay accurate. People who played or watched those games may still recognize them (see the Privacy Policy, Section 8).

You can download a copy of your data (profile, ratings and match history) in Settings before deleting. See the Privacy Policy for details, including backup retention. Records about copyright notices and repeat infringement are kept as described in Section 11.5.

### 8.4 Effect of termination

When your account is terminated or deleted, your license to use the Service ends. The following survive: Section 6.3 (to the extent it concerns past conduct), this Section 8.4, and the sections titled Intellectual property, Copyright complaints (DMCA), Third-party services and links, Disclaimers, Limitation of liability, Indemnity, Governing law, Informal dispute resolution first, the Arbitration Agreement (if any), Court proceedings, Changes to these Terms, General terms, and Contact us.

## 9. Changes to the Service

The Service is evolving. We may add, change, or remove features (including game modes, civilizations, rules, bots, time controls and rating systems) at any time. Game rules are versioned; a rules change applies only to games started after it takes effect.

**The Service is currently free.** If we introduce paid features, virtual items or subscriptions, additional terms will be presented before purchase, and those terms will govern the purchase.

## 10. Intellectual property

### 10.1 Our content

The Service and everything in it that we provide, including the software, game rules implementation, bots, artwork, civilization emblems, board and piece designs, sounds, text, logos and the "[GAME NAME]" name, are owned by us or our licensors and are protected by copyright, trademark and other laws. Except for the license in Section 5, these Terms do not give you any rights in our content or trademarks.

Some parts of the Service may include open-source software. Open-source components are licensed under their own licenses, which we will make available in or with the Service. Those licenses control over these Terms for those components.

### 10.2 Your content

"**Your content**" means anything you create, submit or generate in the Service, including your username, lobby names, your moves and game actions, match records, reports you submit, and, if we add them, chat messages, emotes and profile content.

**You keep whatever rights you have in your content.** But you give us a license to use it so we can run the Service:

- You grant us a worldwide, non-exclusive, royalty-free, sublicensable (to our service providers and to other users, as needed to operate the Service) license to host, store, copy, display, transmit, adapt (for example, to fit different screen sizes or to replace your username with a placeholder), and distribute your content in connection with operating, providing and improving the Service, and, for promotion, only in the ordinary display of game results, leaderboards and replays within the Service.
- We will not use your username, likeness or content in advertising outside the Service without your separate consent (and, if you are under 18, your parent or guardian's consent).
- **Match records** (moves, timings, results and placements) are shared records of games played with other people. The license to match records is **perpetual and irrevocable**, so that other players' histories, ratings and replays remain accurate after you leave. When you delete your account, your match records are kept under a placeholder name instead of your username.
- For other content (such as your username), the license ends when you delete the content or your account, except for copies in backups until they expire, and copies we must keep to comply with law or enforce these Terms.

You confirm that you have the rights needed to grant this license and that your content does not violate these Terms or anyone else's rights.

### 10.3 Feedback

If you send us ideas, suggestions or feedback, we may use them for any purpose without paying you or crediting you.

## 11. Copyright complaints (DMCA)

We respect intellectual property rights and respond to notices of alleged infringement under the Digital Millennium Copyright Act, 17 U.S.C. § 512 ("**DMCA**").

### 11.1 Designated agent

Send copyright notices to our designated agent:

> **[DMCA AGENT NAME / TITLE]**
> [OPERATOR LEGAL NAME]
> [DMCA AGENT ADDRESS]
> Email: [DMCA EMAIL]
> Phone: [DMCA PHONE]

> [Drafting note: The agent must be registered with the US Copyright Office's DMCA Designated Agent Directory (currently $6, renewed every three years) before launch, and the details here must match the registration exactly. A business mailing address or registered-agent address avoids publishing a home address.]

### 11.2 How to send a takedown notice

Your notice must be in writing and include:

1. your physical or electronic signature;
2. identification of the copyrighted work you claim is infringed (or, if multiple works, a representative list);
3. identification of the material you claim is infringing and enough information for us to locate it (for example, the username, lobby name, or the date and time of the game where it appeared);
4. your name, address, telephone number and email address;
5. a statement that you have a good-faith belief that the use is not authorized by the copyright owner, its agent, or the law; and
6. a statement that the information in the notice is accurate and, **under penalty of perjury**, that you are the copyright owner or authorized to act on the owner's behalf.

Notices that do not substantially meet these requirements may not be acted on. **Under 17 U.S.C. § 512(f), anyone who knowingly makes a material misrepresentation in a notice or counter-notice may be liable for damages.** Trademark or other non-copyright complaints should be sent to [CONTACT EMAIL], not to the DMCA agent.

### 11.3 What we do

When we receive a valid notice, we will remove or disable access to the material, take reasonable steps to notify the user who posted it, and give them a copy of the notice (which may include the sender's contact information).

### 11.4 Counter-notices

If you believe material was removed by mistake or misidentification, you may send a counter-notice to our designated agent that includes:

1. your physical or electronic signature;
2. identification of the material removed and where it appeared before removal;
3. a statement **under penalty of perjury** that you have a good-faith belief the material was removed or disabled as a result of mistake or misidentification;
4. your name, address and telephone number; and
5. a statement that you consent to the jurisdiction of the US federal district court for the judicial district where your address is located (or, if your address is outside the United States, any judicial district in which we may be found), and that you will accept service of process from the person who sent the original notice or that person's agent.

We will forward a valid counter-notice to the original complainant. Unless the complainant tells us within 10 business days that it has filed a court action seeking to restrain the activity, we will restore the material (or stop disabling access) within 10 to 14 business days after we receive the counter-notice.

### 11.5 Repeat infringers

We will, in appropriate circumstances, **terminate the accounts of users who are repeat infringers**. A user is generally a repeat infringer if we have removed their material in response to valid notices on two or more occasions that were not successfully countered. We may also terminate accounts after a single instance of clear or willful infringement.

We keep records of copyright notices, counter-notices and repeat-infringer determinations, linked to the account and to a one-way keyed hash of its email address, for [3] years after the last notice, including after an account is deleted, so that terminated repeat infringers cannot re-register.

## 12. Third-party services and links

The Service relies on and may link to services we do not control, such as sign-in providers (Google, Discord, GitHub, Microsoft, and later Steam) and our infrastructure providers. We are not responsible for third-party services, their content, or their availability. Your use of them is at your own risk and under their terms.

## 13. Disclaimers

THE SERVICE IS PROVIDED **"AS IS" AND "AS AVAILABLE,"** WITH ALL FAULTS AND WITHOUT WARRANTIES OF ANY KIND. TO THE FULLEST EXTENT PERMITTED BY LAW, WE AND OUR AFFILIATES, OFFICERS, EMPLOYEES, CONTRACTORS, AGENTS AND LICENSORS DISCLAIM ALL WARRANTIES, EXPRESS, IMPLIED OR STATUTORY, INCLUDING ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, QUIET ENJOYMENT, AND ANY WARRANTIES ARISING FROM COURSE OF DEALING OR USAGE OF TRADE.

WITHOUT LIMITING THE ABOVE, WE DO NOT WARRANT THAT: THE SERVICE WILL BE UNINTERRUPTED, TIMELY, SECURE OR ERROR-FREE; GAMES WILL NOT BE INTERRUPTED, LOST OR ABORTED (FOR EXAMPLE, BY A SERVER RESTART OR A DISCONNECTION); CLOCKS, RESULTS, RATINGS OR MATCH HISTORY WILL BE ACCURATE OR PRESERVED; BOT STRENGTH LABELS WILL BE ACCURATE; CHEATING OR MISCONDUCT BY OTHER PLAYERS WILL BE DETECTED OR PREVENTED; OR ANY DATA (INCLUDING GUEST ACCOUNTS) WILL BE STORED OR RECOVERABLE.

WE ARE NOT RESPONSIBLE FOR THE CONDUCT OF OTHER PLAYERS, ONLINE OR OFFLINE.

ANY IMPLIED WARRANTY THAT APPLICABLE LAW DOES NOT ALLOW US TO DISCLAIM IS LIMITED TO 90 DAYS FROM YOUR FIRST USE OF THE SERVICE, TO THE FULLEST EXTENT PERMITTED BY LAW.

**For New Jersey residents:** the limitations in Sections 13 and 14 do not apply to liability that N.J.S.A. 56:12-15 or other New Jersey law prohibits contracts from limiting, including liability for gross negligence or willful misconduct. Every other provision of Sections 13–15 applies in New Jersey.

## 14. Limitation of liability

TO THE FULLEST EXTENT PERMITTED BY LAW:

(A) WE AND OUR AFFILIATES, OFFICERS, EMPLOYEES, CONTRACTORS, AGENTS AND LICENSORS WILL NOT BE LIABLE FOR ANY **INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY OR PUNITIVE DAMAGES**, OR FOR ANY LOSS OF PROFITS, REVENUE, DATA, RATINGS, MATCH HISTORY, PROGRESS, GOODWILL OR USE, ARISING OUT OF OR RELATING TO THESE TERMS OR THE SERVICE, WHETHER BASED ON CONTRACT, TORT (INCLUDING NEGLIGENCE), STRICT LIABILITY OR ANY OTHER THEORY, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

(B) OUR TOTAL LIABILITY FOR ALL CLAIMS ARISING OUT OF OR RELATING TO THESE TERMS OR THE SERVICE WILL NOT EXCEED THE GREATER OF **(1) THE AMOUNT YOU PAID US FOR THE SERVICE IN THE 12 MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM, OR (2) ONE HUNDRED US DOLLARS (US $100).**

(C) THESE LIMITATIONS APPLY EVEN IF A REMEDY FAILS OF ITS ESSENTIAL PURPOSE. THEY ARE AN ESSENTIAL PART OF THE BARGAIN BETWEEN YOU AND US; WE COULD NOT OFFER THE SERVICE FOR FREE WITHOUT THEM.

(D) NOTHING IN THESE TERMS LIMITS OR EXCLUDES LIABILITY THAT CANNOT BE LIMITED OR EXCLUDED UNDER APPLICABLE LAW, SUCH AS LIABILITY FOR DEATH OR PERSONAL INJURY CAUSED BY OUR NEGLIGENCE, FOR FRAUD, OR FOR GROSS NEGLIGENCE OR WILLFUL MISCONDUCT WHERE THE LAW DOES NOT PERMIT A LIMITATION. FOR NEW JERSEY RESIDENTS, SEE THE LAST PARAGRAPH OF SECTION 13.

> [Drafting note: PLAN §8 calls for a liability cap under Option B. The cap above applies under both dispute options, so it does not need to be repeated in Option B. TCCWNA § 16 (N.J.S.A. 56:12-16) bars generic "some jurisdictions" language unless the contract specifies which provisions do not apply in New Jersey (*Martinez-Santiago v. Public Storage*, D.N.J. 2014; standing narrowed by *Spade v. Select Comfort*, N.J. 2018). v0.2 therefore removes the generic "some jurisdictions" sentences and adds a New Jersey-specific statement at the end of Section 13. Counsel to confirm that the New Jersey statement accurately lists what New Jersey law does not allow a contract to limit.]

## 15. Indemnity

To the extent permitted by law, you agree to defend, indemnify and hold harmless us and our affiliates, officers, employees, contractors and agents from and against any third-party claims, and related losses, liabilities, damages, costs and reasonable attorneys' fees, arising out of:

- your violation of these Terms;
- your content; or
- your violation of any law or the rights of any third party.

This does not apply to the extent a claim is caused by our own negligence or misconduct. We will promptly tell you about any claim, let you control its defense with counsel reasonably acceptable to us (we may participate at our own expense), and you will not settle a claim that imposes obligations on us without our written consent.

## 16. Governing law

These Terms, and any dispute between you and us, are governed by the laws of the **State of [STATE]** and applicable US federal law, without regard to conflict-of-law rules. [OPTION A ONLY: The Federal Arbitration Act, 9 U.S.C. § 1 et seq., governs the interpretation and enforcement of Section 18.]

If you live outside the United States, this choice of law does not deprive you of the protection of mandatory consumer-protection laws of the country where you live.

The United Nations Convention on Contracts for the International Sale of Goods does not apply.

> [Drafting note: v0.1 had a Section 17 imposing a one-year contractual limitations period. It was deleted in v0.2: it is void in some states (e.g., Fla. Stat. § 95.03; Tex. Civ. Prac. & Rem. Code § 16.070, under two years) and is a substantive-unconscionability factor in California (*Martinez v. Master Protection Corp.*, 2004) that, combined with other terms, risks a court refusing to sever under *Armendariz*. If the operator insists on a limitations clause, use only: "To the extent permitted by the law of the state where you live, a claim arising out of these Terms must be brought within the time allowed by the applicable statute of limitations. Nothing in these Terms shortens that period."]

## 17. Informal dispute resolution first

Most problems can be solved quickly. Before starting any arbitration or court case (except a small-claims case), you and we each agree to first try to resolve the dispute informally:

1. **Send a written notice** by email to [CONTACT EMAIL] (or by mail to [ADDRESS], if you prefer) describing the dispute, the relief requested, and your username and the email on your account. We send ours to the email address on your account.
2. **Talk.** Within 30 days after the notice is received, either side may request an individual phone or video conference. You may attend with or through a lawyer, but we may ask that you join the call so that we can discuss your individual claim. A representative of ours with authority to settle will attend.
3. **Wait 60 days.** If the dispute is not resolved within 60 days after the notice is received, either side may proceed under the Arbitration Agreement (if any) or the Court proceedings section, whichever applies.

All statutes of limitations are tolled from the date the notice is received until 60 days after it, or until the process ends, whichever is later. This section does not replace any pre-suit notice that a statute requires, and it does not change any deadline for us to pay arbitration fees.

---

> **[Drafting note for the reviewing attorney — choose ONE dispute option.** Under Option A, keep Section 18 and Section 19. Under Option B, delete Section 18 only. See the bracketed instructions at the top of each section.
>
> **Option A (Arbitration)** — *For:* avoids class actions (the main litigation risk for a small free-to-play service, e.g. privacy/biometric/BIPA-style or consumer-protection class claims); private, typically cheaper per case; enforceable under the FAA (*AT&T Mobility v. Concepcion*, 2011; *Epic Systems v. Lewis*, 2018). *Against:* (1) under the AAA Consumer Arbitration Rules or JAMS Consumer Minimum Standards, the business pays nearly all fees (currently on the order of several hundred to a few thousand dollars per case before arbitrator compensation), so a coordinated "mass arbitration" of hundreds of claimants can cost far more than a class action; (2) Cal. CCP §§ 1281.97–1281.98: if the business pays arbitration fees more than 30 days after the due date, the consumer may withdraw to court and seek sanctions. In *Hohenshelt v. Superior Court* (Cal. Aug. 11, 2025, S284498) the court held these sections not preempted by the FAA, with relief from forfeiture only for non-willful, non-grossly-negligent delay where the late party compensates the other side. Treat the 30-day deadline as absolute and calendar every invoice. In a mass filing this means paying for hundreds of cases within 30 days; (3) minors can generally disaffirm contracts, including the arbitration clause and its delegation provision (*R.A. v. Epic Games*; *Doe v. Epic Games*; *J.R. v. Electronic Arts* — see the note to Section 3.2). Expect Section 18 to be unenforceable against users who disaffirm while minors; budget accordingly; 13–17-year-olds are a meaningful share of this audience; (4) batching clauses must stay administrative only — *Heckman v. Live Nation Entertainment*, 120 F.4th 670 (9th Cir. 2024) refused to enforce an aggressive mass-arbitration protocol as unconscionable and, in an alternate holding, held that the FAA does not preempt California's *Discover Bank* rule as applied to non-bilateral ("aggregative") procedures; (5) California's *McGill v. Citibank* (2017) rule means public-injunctive-relief claims cannot be waived and must be carved out to a court; (6) the clause needs conspicuous notice at the top of the Terms and in the clickwrap (see the drafting note to Section 2) to survive *Berman*-type challenges; (7) the AAA requires clause registration and a fee before it will administer consumer cases (see the note to Section 18.3).
>
> **Option B (Courts)** — *For:* no per-case arbitration fees and no mass-arbitration exposure; simpler and more understandable to a young audience; no unconscionability litigation over the clause itself. *Against:* class actions remain available; litigation in a public forum; out-of-state consumers may resist the forum-selection clause, and pre-dispute jury waivers are unenforceable in some states (e.g. California, *Grafton Partners v. Superior Court*, 2005; Georgia). The liability cap in Section 14 and the informal-resolution step in Section 17 apply under both options.
>
> For a free product with no payments and a modest user base, many small studios choose Option B and revisit arbitration when revenue (and class-action exposure) grows. If Option A is chosen, confirm the current AAA/JAMS fee schedules and mass-arbitration rules at publication.]**

---

## 18. Arbitration Agreement (Option A)

**[OPTION A — keep this Section 18 AND keep all of Section 19 (Court proceedings), which then applies only if you opt out under Section 18.7, to claims excluded from arbitration, or if this Section 18 is held unenforceable. OPTION B — delete this Section 18, the notice box at the top, the arbitration line under the checkbox (drafting note to Section 2), the FAA sentence in Section 16, the reference to Section 18.9 in Section 20, and the Option A parenthetical in "Severability" in Section 21; then renumber Sections 19–22 as 18–21 and update the cross-references to them.]**

### 18.1 Agreement to arbitrate

You and we agree that any dispute, claim or controversy arising out of or relating to these Terms, the Service, or your relationship with us (each a "**Dispute**"), whether based on contract, tort, statute, fraud or any other legal theory, and whether it arose before or after you accepted these Terms, will be resolved by **binding individual arbitration**, and not in court, except as stated in Section 18.2.

**There is no judge or jury in arbitration, and court review of an arbitration award is limited.** An arbitrator can award the same damages and relief on an individual basis that a court can award to an individual, and must follow these Terms as a court would.

### 18.2 Exceptions

The following do not have to be arbitrated:

- **Small claims.** Either party may bring an individual claim in small-claims court in the county where you live or in [COUNTY], [STATE], if it qualifies and stays in that court on an individual basis.
- **Temporary relief.** Either party may ask a court for a temporary restraining order or preliminary injunction to preserve the status quo while an arbitration is pending (for example, to stop ongoing infringement, an attack on the Service, or distribution of cheat tools), as permitted by 9 U.S.C. and Cal. Code Civ. Proc. § 1281.8. The merits of the underlying claim will be decided in arbitration.
- **Public injunctive relief.** To the extent a claim seeks public injunctive relief that applicable law does not allow to be waived in arbitration, that claim will be severed, stayed until the arbitrable claims are decided, and then decided by a court under Section 19 (Court proceedings).

### 18.3 Arbitration rules and administrator

The arbitration will be administered by the **American Arbitration Association ("AAA")** under its **Consumer Arbitration Rules** (and, where applicable, its Mass Arbitration Supplementary Rules) in effect when the arbitration is filed, as modified by these Terms. The rules are available at www.adr.org.

If the AAA is unavailable or unwilling to administer the arbitration consistent with these Terms, the arbitration will be administered by **JAMS** under its **Streamlined Arbitration Rules and Procedures** and **Consumer Arbitration Minimum Standards** (and, where applicable, its Mass Arbitration Procedures), available at www.jamsadr.com. If neither is available, a court will appoint an arbitrator under 9 U.S.C. § 5.

> [Drafting note: Choose AAA (primary) with JAMS fallback as drafted, or reverse them. Confirm both providers' current consumer fee schedules and mass-arbitration rules. Before publication, submit this clause to the AAA Consumer Clause Registry (Consumer Rule R-12, rules amended effective May 1, 2025) at least 30 days before the effective date, pay the annual review/registry fee, and renew each year. Re-submit after any material change. If the clause is not registered or the fee is unpaid, the AAA may decline to administer, which triggers the JAMS fallback (JAMS applies its own Consumer Minimum Standards review). Confirm that the AAA does not object to Section 18.8 or to any other term under the Consumer Due Process Protocol. Tracked in TODO.md.]

### 18.4 Procedure, location and fees

- **Starting an arbitration.** After completing the informal process in Section 17, a party starts arbitration by filing a demand with the administrator and sending a copy to the other party. The demand must be individually signed by the claimant (and by counsel, if represented) and must describe the claim in reasonable detail.
- **Location.** Unless both parties agree otherwise, any hearing will take place by video conference, or in person in the county where you live if you prefer. If your claim is for $10,000 or less, it will be decided on written submissions alone unless you or the arbitrator request a hearing.
- **Fees.** Fees are paid according to the administrator's consumer rules. Generally, we pay all administrative and arbitrator fees except the consumer filing fee, and if you show that even that fee would be a hardship, we will pay it. Each party pays its own attorneys' fees and costs unless the law or the administrator's rules provide otherwise. We will not seek attorneys' fees from you unless the arbitrator finds your claim frivolous or brought for an improper purpose.
- **Timely payment.** We will pay our share of fees within the time required by the administrator and applicable law.
- **Decision.** The arbitrator will issue a written decision stating the essential findings and conclusions. Judgment on the award may be entered in any court with jurisdiction.

### 18.5 Who decides what (delegation)

The arbitrator decides all issues about the scope, enforceability, validity, unconscionability, and arbitrability of this Section 18, **except** that a court (not the arbitrator) decides (a) whether Section 18.6 (class-action waiver) or Section 18.8 (mass arbitration) is enforceable or has been violated, and (b) any dispute about whether a claim falls within the small-claims, temporary-relief or public-injunctive-relief exceptions.

### 18.6 Class-action and jury waiver

YOU AND WE AGREE THAT EACH MAY BRING CLAIMS AGAINST THE OTHER **ONLY IN AN INDIVIDUAL CAPACITY, AND NOT AS A PLAINTIFF OR CLASS MEMBER IN ANY PURPORTED CLASS, COLLECTIVE, CONSOLIDATED, PRIVATE ATTORNEY GENERAL OR REPRESENTATIVE PROCEEDING.** THE ARBITRATOR MAY NOT CONSOLIDATE MORE THAN ONE PERSON'S CLAIMS (ADMINISTRATIVE GROUPING UNDER SECTION 18.8 IS NOT CONSOLIDATION) AND MAY AWARD RELIEF ONLY IN FAVOR OF THE INDIVIDUAL PARTY SEEKING RELIEF AND ONLY TO THE EXTENT NECESSARY TO PROVIDE RELIEF FOR THAT PARTY'S INDIVIDUAL CLAIM. **YOU AND WE EACH WAIVE THE RIGHT TO A JURY TRIAL** FOR ANY DISPUTE SUBJECT TO ARBITRATION.

If a court decides, after all appeals, that this class-action waiver is unenforceable as to a particular claim or request for relief, then that claim or request (and only that one) will be severed and decided by a court under Section 19 (Court proceedings), after the individual arbitration is complete, and the rest of this Section 18 still applies.

### 18.7 Your right to opt out (30 days)

**You may opt out of this arbitration agreement** by sending an email to [CONTACT EMAIL] with the subject line "Arbitration Opt-Out" (or a letter to [ADDRESS]) **within 30 days after you first accept these Terms**. Your notice must include your name, your username, the email address on your account (if any), and a clear statement that you want to opt out of arbitration. A parent or guardian may opt out for a minor.

Opting out does not affect any other part of these Terms; Section 19 (Court proceedings) will apply to you instead. If you opted out of a prior version, that choice remains in effect. Opting out on behalf of other people is not allowed.

### 18.8 Mass arbitration

If **25 or more** demands for arbitration raising substantially similar claims are filed against us (or by us) by or with the assistance of the same or coordinated counsel or organizations ("**Mass Filing**"):

1. **Rules.** The administrator's mass-arbitration rules in effect at filing (AAA Mass Arbitration Supplementary Rules or JAMS Mass Arbitration Procedures) govern the Mass Filing, including fees.
2. **Batching.** To the extent those rules allow, the parties ask the process arbitrator (or administrator) to group the demands into batches of up to **100** for administrative purposes. Each claimant's claim will be heard and decided individually on its own merits and record, and no decision in one claimant's case binds any other claimant.
3. **Order.** Batches will proceed in the order the demands were filed. Unless the parties agree otherwise, the administrator may proceed with multiple batches at the same time.
4. **Tolling.** The statute of limitations for any demand waiting in a later batch is tolled from the date the demand was filed until its batch is assigned.
5. **Settlement.** Nothing in this section prevents the parties from agreeing to resolve all or some demands at any point, including through a global mediation.

If a court decides that this Section 18.8 is unenforceable as to a Mass Filing, the Mass Filing will proceed under the administrator's rules without this section.

> [Drafting note: The batching clause is deliberately administrative only (the administrator's own mass-arbitration rules govern fees and procedure; batches of 100 run in parallel; no mandatory waiting periods, sequential bellwethers or shared decisions). *Heckman v. Live Nation* (9th Cir. 2024) refused to enforce an aggressive protocol as unconscionable, and its alternate holding means any non-bilateral protocol may reopen class exposure in the Ninth Circuit under *Discover Bank*. Keep batching administrative only. Counsel may adjust the threshold (25) and batch size (100).]

### 18.9 Changes to this arbitration agreement

If we make a material change to this Section 18, we will notify you at least 30 days before it takes effect. You may reject the change by emailing [CONTACT EMAIL] within 30 days after the notice; if you do, the most recent version of this Section 18 you accepted will continue to apply to you. A change will not apply to any claim that accrued, or any Dispute of which either party had notice, before the change took effect.

### 18.10 Severability of this section

If any part of this Section 18 is found unenforceable, the rest of it remains in effect, except as stated in Sections 18.6 and 18.8. If the entire Section 18 is found unenforceable as to a Dispute, Section 19 (Court proceedings) will apply to that Dispute.

### 18.11 Survival

This Section 18 survives termination of these Terms and deletion of your account.

---

## 19. Court proceedings

**[KEEP UNDER BOTH OPTIONS. Under Option A, this Section applies only if you opt out under Section 18.7, to claims excluded from arbitration (Section 18.2), or if Section 18 is held unenforceable. Under Option B, it applies to all Disputes; delete the bracketed Option A sentence in Section 19.1.]**

### 19.1 When this section applies

[OPTION A ONLY: This Section 19 applies if you opted out of arbitration under Section 18.7, to claims that Section 18.2 excludes from arbitration, and to any Dispute as to which Section 18 is held unenforceable.] [OPTION B ONLY: Disputes between you and us will be resolved in court, not in arbitration, after the informal process in Section 17.]

### 19.2 Small claims

Either party may bring an individual claim in **small-claims court** in the county where you live or in [COUNTY], [STATE], if the claim qualifies. Small-claims cases are not subject to the venue requirement in Section 19.3.

### 19.3 Exclusive venue

Any lawsuit permitted under these Terms, other than a small-claims case, must be brought **exclusively in the state courts located in [COUNTY], [STATE], or the United States District Court for the [DISTRICT] of [STATE]**. You and we consent to the personal jurisdiction of those courts and waive any objection based on inconvenient forum.

This does not prevent either party from seeking emergency injunctive relief in any court with jurisdiction to protect intellectual property or to stop an ongoing attack on the Service.

If you live outside the United States and mandatory law of your country entitles you to bring a claim in your local courts, this section does not take away that right.

### 19.4 Jury waiver (only where enforceable)

TO THE EXTENT PERMITTED BY APPLICABLE LAW, YOU AND WE EACH **WAIVE THE RIGHT TO A TRIAL BY JURY** IN ANY LAWSUIT ARISING OUT OF OR RELATING TO THESE TERMS OR THE SERVICE. THIS WAIVER DOES NOT APPLY IN ANY STATE WHOSE LAW DOES NOT ALLOW PRE-DISPUTE JURY WAIVERS IN CONSUMER CONTRACTS.

> [Drafting note: Pre-dispute jury waivers are unenforceable in California (*Grafton Partners*, 2005) and Georgia, and scrutinized elsewhere. If the operator's state is one of these, consider deleting Section 19.4 entirely.]

---

## 20. Changes to these Terms

We may update these Terms from time to time, for example to reflect new features (such as chat or a Steam client), legal requirements, or how we operate.

- **Notice.** We will post the updated Terms with a new version number and effective date. For **material changes**, we will also notify you by email (if you have an account with an email address) or by a prominent notice in the Service, at least **30 days** before they take effect, unless the change is required sooner by law or to address a security or safety issue.
- **Re-acceptance.** For material changes, we will ask you to accept the updated Terms (by checking a box) before you can continue to use the Service. If you do not accept, you may delete your account and stop using the Service; the version you last accepted continues to govern your past use. [OPTION A ONLY: If you rejected a change to Section 18 under Section 18.9, accepting the updated Terms does not accept that change, and the version of Section 18 you last accepted continues to apply to you.]
- **Non-material changes** (such as fixing typos, clarifying wording, or updating contact details) take effect when posted.
- **No retroactive effect on disputes.** A change will not apply to any claim that accrued, or any Dispute of which either party had notice, before the change took effect. [OPTION A ONLY: Changes to the arbitration agreement are also subject to Section 18.9.]

## 21. General terms

- **Entire agreement.** These Terms and any additional terms we present for specific features are the entire agreement between you and us about the Service and replace any earlier agreements on that subject.
- **Electronic communications.** You agree that we may communicate with you electronically, including by email and in-Service notices, and that electronic communications satisfy any legal requirement that a communication be in writing. Our emails are transactional (for example, verification, password reset and security alerts). We will not send marketing emails without your separate opt-in.
- **Assignment.** You may not transfer these Terms or your account. We may assign these Terms in connection with a merger, acquisition, reorganization or sale of assets, or by operation of law, and will notify you if we do.
- **Severability.** If any provision is held unenforceable, it will be enforced to the maximum extent permissible and the rest of these Terms will remain in effect [OPTION A ONLY: (subject to the class-action waiver, mass-arbitration and severability provisions of the Arbitration Agreement)].
- **No waiver.** Our failure to enforce a provision is not a waiver of our right to do so later.
- **Force majeure.** We are not liable for delays or failures caused by events beyond our reasonable control, including outages of hosting, network or sign-in providers, cyberattacks, natural disasters, labor disputes or government action.
- **No third-party beneficiaries.** These Terms do not give rights to anyone other than you and us, except that the people listed in the Disclaimers, Limitation of liability and Indemnity sections may enforce those sections.
- **Export and sanctions.** You will comply with US export-control and sanctions laws in using the Service.
- **Interpretation.** Headings are for convenience only. "Including" means "including without limitation." If we provide a translation, the English version controls to the extent permitted by law.
- **California users.** Under California Civil Code § 1789.3, California users are entitled to the following notice: the Complaint Assistance Unit of the Division of Consumer Services of the California Department of Consumer Affairs may be contacted in writing at 1625 North Market Blvd., Suite N 112, Sacramento, CA 95834, or by telephone at (800) 952-5210.

## 22. Contact us

**[OPERATOR LEGAL NAME]**
[ADDRESS]
General and legal questions: [CONTACT EMAIL]
Privacy questions and reports about users under 13: [PRIVACY CONTACT EMAIL]
Security and account-compromise reports: [SECURITY CONTACT EMAIL]
Copyright (DMCA) notices: see Section 11.1

---

*Version v0.2 (draft) · Effective [EFFECTIVE DATE]*

---

> **[Notes for reviewing attorney — open decisions (delete before publication)**
>
> 1. **Dispute option: A (arbitration) or B (courts).** See the drafting note before Section 18. Under A: keep Sections 18 and 19, the notice box and the checkbox arbitration line; register the clause with the AAA Consumer Clause Registry at least 30 days before the effective date (Section 18.3 note); calendar every fee invoice against the 30-day *Hohenshelt* / CCP § 1281.98 deadline; expect Section 18 to fail against users who disaffirm while minors. Under B: delete Section 18 and every item listed in its bracketed header.
> 2. **Governing state, venue and entity.** Fill [STATE], [COUNTY], [DISTRICT] and [ENTITY TYPE]. If the state is California or Georgia, consider deleting the jury waiver in Section 19.4. The governing-law choice does not prevent California users from invoking CCP §§ 1281.97–1281.98 in California courts; budget as if it applies.
> 3. **Guardian language.** Choose (a) a guardian confirmation step for users in the 13–15 and 16–17 bands, with parental agreement and indemnity, or (b) the current minor-only permission representation (Section 3.2 note). Under (b), the parent is not a party.
> 4. **EU/UK representative (GDPR / UK GDPR Art. 27).** Either appoint EU and UK representatives before launch and name them in the Privacy Policy (Section 11.3), or decide in writing not to serve the EEA/UK, enforce that with geo-blocking, and keep the bracketed eligibility bullet in Section 3.3. Do not publish a statement that no representative has been appointed.
> 5. **Limitations period.** Section 17 (one-year limit) was deleted in v0.2. Confirm. Do not reinstate it except in the non-shortening form given in the Section 16 note.
> 6. **New Jersey statement** (end of Section 13). Confirm it accurately describes what New Jersey law does not allow a contract to limit.
> 7. **Retention periods to fix:** DMCA/repeat-infringer records ([3] years, Section 11.5); support emails and moderation records (Privacy Policy, Section 8).
> 8. **Product prerequisites the Terms now assume** (tracked in TODO.md): the clickwrap gates every account-creation path, including OAuth, passkey, Steam/Unity first launch and device-code linking; the checkbox reads "I agree to the [Terms of Service] and acknowledge that I have read the [Privacy Policy]."; age band (13–15 / 16–17 / 18+) stored instead of a bare 13+ flag; per-account DMCA strike records survive deletion.]**
