# Implementation Patterns

Common patterns for building Arcium applications, with code from the examples repository.

## Pattern 1: Stateless Operation (Coinflip)

**Use when**: Single computation, no persistent state needed.

```rust
use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    pub struct UserChoice {
        pub choice: bool,
    }

    #[instruction]
    pub fn flip(input_ctxt: Enc<Shared, UserChoice>) -> bool {
        let input = input_ctxt.to_arcis();
        let toss = ArcisRNG::bool();
        (input.choice == toss).reveal()
    }
}
```

**Key points**:
- Simple input → compute → reveal flow
- MPC randomness (`ArcisRNG::bool()`) is unbiased
- `.reveal()` outputs plaintext result

---

## Pattern 2: Encrypted State Accumulator (Voting)

**Use when**: Aggregating encrypted inputs into persistent state.

```rust
pub struct VoteStats {
    yes: u64,
    no: u64,
}

pub struct UserVote {
    vote: bool,
}

// Initialize state (call once)
#[instruction]
pub fn init_vote_stats(mxe: Mxe) -> Enc<Mxe, VoteStats> {
    mxe.from_arcis(VoteStats { yes: 0, no: 0 })
}

// Accumulate votes (call many times)
#[instruction]
pub fn vote(
    vote_ctxt: Enc<Shared, UserVote>,
    vote_stats_ctxt: Enc<Mxe, VoteStats>,
) -> Enc<Mxe, VoteStats> {
    let user_vote = vote_ctxt.to_arcis();
    let mut vote_stats = vote_stats_ctxt.to_arcis();

    if user_vote.vote {
        vote_stats.yes += 1;
    } else {
        vote_stats.no += 1;
    }

    vote_stats_ctxt.owner.from_arcis(vote_stats)
}

// Reveal result (call once at end)
#[instruction]
pub fn reveal_result(vote_stats_ctxt: Enc<Mxe, VoteStats>) -> bool {
    let stats = vote_stats_ctxt.to_arcis();
    (stats.yes > stats.no).reveal()
}
```

**Key points**:
- `Enc<Mxe, T>` for state only MXE can decrypt
- State updated in-place, re-encrypted to same owner
- Separate init/accumulate/reveal phases

---

## Pattern 3: Encrypted Comparison (Sealed Bid Auction)

**Use when**: Finding max/min without revealing individual values.

```rust
pub struct Bid {
    pub bidder_lo: u128,  // Pubkey split for encryption
    pub bidder_hi: u128,
    pub amount: u64,
}

pub struct AuctionState {
    pub highest_bid: u64,
    pub highest_bidder_lo: u128,
    pub highest_bidder_hi: u128,
    pub second_highest_bid: u64,
    pub bid_count: u8,
}

#[instruction]
pub fn init_auction_state(mxe: Mxe) -> Enc<Mxe, AuctionState> {
    mxe.from_arcis(AuctionState {
        highest_bid: 0,
        highest_bidder_lo: 0,
        highest_bidder_hi: 0,
        second_highest_bid: 0,
        bid_count: 0,
    })
}

#[instruction]
pub fn place_bid(
    bid_ctxt: Enc<Shared, Bid>,
    state_ctxt: Enc<Mxe, AuctionState>,
) -> Enc<Mxe, AuctionState> {
    let bid = bid_ctxt.to_arcis();
    let mut state = state_ctxt.to_arcis();

    if bid.amount > state.highest_bid {
        state.second_highest_bid = state.highest_bid;
        state.highest_bid = bid.amount;
        state.highest_bidder_lo = bid.bidder_lo;
        state.highest_bidder_hi = bid.bidder_hi;
    } else if bid.amount > state.second_highest_bid {
        state.second_highest_bid = bid.amount;
    }

    state.bid_count += 1;
    state_ctxt.owner.from_arcis(state)
}

// First-price auction (winner pays their bid)
#[instruction]
pub fn determine_winner_first_price(state_ctxt: Enc<Mxe, AuctionState>) -> AuctionResult {
    let state = state_ctxt.to_arcis();
    AuctionResult {
        winner_lo: state.highest_bidder_lo,
        winner_hi: state.highest_bidder_hi,
        payment_amount: state.highest_bid,
    }.reveal()
}

// Vickrey auction (winner pays second-highest bid)
#[instruction]
pub fn determine_winner_vickrey(state_ctxt: Enc<Mxe, AuctionState>) -> AuctionResult {
    let state = state_ctxt.to_arcis();
    AuctionResult {
        winner_lo: state.highest_bidder_lo,
        winner_hi: state.highest_bidder_hi,
        payment_amount: state.second_highest_bid,
    }.reveal()
}
```

**Key points**:
- Split large values (pubkeys) into u128 pairs
- Track both highest and second-highest for Vickrey auctions
- Only winner/payment revealed, not individual bids

---

## Pattern 4: Complex State Machine (Blackjack)

**Use when**: Multi-phase game with multiple actors.

```rust
// Efficient deck encoding (52 cards in 3 u128s)
pub struct Deck {
    pub card_one: u128,   // Cards 0-20
    pub card_two: u128,   // Cards 21-41
    pub card_three: u128, // Cards 42-51
}

pub struct Hand {
    pub cards: u128,  // Up to 11 cards encoded
}

// Game initialization
#[instruction]
pub fn shuffle_and_deal_cards(
    mxe: Mxe,
    mxe_again: Mxe,
    client: Shared,
    client_again: Shared,
) -> (Enc<Mxe, Deck>, Enc<Mxe, Hand>, Enc<Shared, Hand>, Enc<Shared, u8>) {
    let mut initial_deck = INITIAL_DECK;
    ArcisRNG::shuffle(&mut initial_deck);
    
    // ... deal cards to players
    (deck, dealer_hand, player_hand, visible_dealer_card)
}

// Player actions
#[instruction]
pub fn player_hit(
    deck_ctxt: Enc<Mxe, Deck>,
    player_hand_ctxt: Enc<Shared, Hand>,
    player_hand_size: u8,
    dealer_hand_size: u8,
) -> (Enc<Shared, Hand>, bool) {
    // Add card, check for bust
}

#[instruction]
pub fn player_stand(player_hand_ctxt: Enc<Shared, Hand>, player_hand_size: u8) -> bool {
    // Check if bust
}

// Game resolution
#[instruction]
pub fn resolve_game(
    player_hand: Enc<Shared, Hand>,
    dealer_hand: Enc<Mxe, Hand>,
    player_hand_length: u8,
    dealer_hand_length: u8,
) -> u8 {
    // 0=player busts, 1=dealer busts, 2=player wins, 3=dealer wins, 4=push
}
```

**Key points**:
- Pack data efficiently (`[u8; 52]` → `3 × u128`)
- Separate instructions for each game action
- Mixed visibility: player sees their hand, dealer's first card only

---

## Data Packing Techniques

### Splitting Large Values
Solana pubkeys are 32 bytes, but Arcis encrypts each primitive. Split into u128 pairs:

```rust
pub struct Bid {
    pub bidder_lo: u128,  // Lower 128 bits
    pub bidder_hi: u128,  // Upper 128 bits
    pub amount: u64,
}
```

### Base-64 Encoding for Cards
Pack multiple 6-bit values (0-63) into u128:

```rust
const POWS_OF_SIXTY_FOUR: [u128; 21] = [1, 64, 4096, ...];

fn from_array(array: [u8; 52]) -> Deck {
    let mut card_one = 0;
    for i in 0..21 {
        card_one += POWS_OF_SIXTY_FOUR[i] * array[i] as u128;
    }
    // ...
}
```

---

## External References
- [coinflip example](https://github.com/arcium-hq/examples/tree/main/coinflip)
- [voting example](https://github.com/arcium-hq/examples/tree/main/voting)  
- [sealed_bid_auction example](https://github.com/arcium-hq/examples/tree/main/sealed_bid_auction)
- [blackjack example](https://github.com/arcium-hq/examples/tree/main/blackjack)
