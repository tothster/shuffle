// =============================================================================
// OFF-CHAIN CIRCUIT CONFIGURATION
// =============================================================================
// Add these imports at the top of lib.rs:
//
// use arcium_client::idl::arcium::types::{CircuitSource, OffChainCircuitSource};
// use arcium_macros::circuit_hash;
//
// Then replace each init_*_comp_def function with the version below.
// =============================================================================

pub fn init_add_balance_comp_def(ctx: Context<InitAddBalanceCompDef>) -> Result<()> {
    init_comp_def(
        ctx.accounts,
        Some(CircuitSource::OffChain(OffChainCircuitSource {
            source: "https://gateway.pinata.cloud/ipfs/QmdbkwigmEYcXPaDGdFJYhVKGC2c1WDfznBBxt8Rc1vZmM".to_string(),
            hash: circuit_hash!("add_balance"),
        })),
        None,
    )?;
    Ok(())
}

pub fn init_sub_balance_comp_def(ctx: Context<InitSubBalanceCompDef>) -> Result<()> {
    init_comp_def(
        ctx.accounts,
        Some(CircuitSource::OffChain(OffChainCircuitSource {
            source: "https://gateway.pinata.cloud/ipfs/QmSfQjsdRAiXEU9b8qH2d1fgmyn1P7wcRCd28DE1e5Y3nC".to_string(),
            hash: circuit_hash!("sub_balance"),
        })),
        None,
    )?;
    Ok(())
}

pub fn init_transfer_comp_def(ctx: Context<InitTransferCompDef>) -> Result<()> {
    init_comp_def(
        ctx.accounts,
        Some(CircuitSource::OffChain(OffChainCircuitSource {
            source: "https://gateway.pinata.cloud/ipfs/QmQAK9JvndSP3YePGq9ciSeuCk8boHfQy5xi3RZTHS9iDW".to_string(),
            hash: circuit_hash!("transfer"),
        })),
        None,
    )?;
    Ok(())
}

pub fn init_accumulate_order_comp_def(ctx: Context<InitAccumulateOrderCompDef>) -> Result<()> {
    init_comp_def(
        ctx.accounts,
        Some(CircuitSource::OffChain(OffChainCircuitSource {
            source: "https://gateway.pinata.cloud/ipfs/QmS812p35akHhFK2yQwGynvjpkPZRV3RjUjdBEC4QJYdwp".to_string(),
            hash: circuit_hash!("accumulate_order"),
        })),
        None,
    )?;
    Ok(())
}

pub fn init_init_batch_state_comp_def(ctx: Context<InitInitBatchStateCompDef>) -> Result<()> {
    init_comp_def(
        ctx.accounts,
        Some(CircuitSource::OffChain(OffChainCircuitSource {
            source: "https://gateway.pinata.cloud/ipfs/QmbBzp7G3o2KqGPFdzjB5Y7ioujpvR5TT54bpLsoo7QZv7".to_string(),
            hash: circuit_hash!("init_batch_state"),
        })),
        None,
    )?;
    Ok(())
}

pub fn init_reveal_batch_comp_def(ctx: Context<InitRevealBatchCompDef>) -> Result<()> {
    init_comp_def(
        ctx.accounts,
        Some(CircuitSource::OffChain(OffChainCircuitSource {
            source: "https://gateway.pinata.cloud/ipfs/Qmc311AdUo1eE7Pm8F8ctDEfX5FJ2SQ4ATDvJi4YXMjmQ8".to_string(),
            hash: circuit_hash!("reveal_batch"),
        })),
        None,
    )?;
    Ok(())
}

pub fn init_calculate_payout_comp_def(ctx: Context<InitCalculatePayoutCompDef>) -> Result<()> {
    init_comp_def(
        ctx.accounts,
        Some(CircuitSource::OffChain(OffChainCircuitSource {
            source: "https://gateway.pinata.cloud/ipfs/QmT8bDc6mba5H3bpAJrtDFBYnSTKLKoMFxhm6TmnMNHSnA".to_string(),
            hash: circuit_hash!("calculate_payout"),
        })),
        None,
    )?;
    Ok(())
}

pub fn init_add_together_comp_def(ctx: Context<InitAddTogetherCompDef>) -> Result<()> {
    init_comp_def(
        ctx.accounts,
        Some(CircuitSource::OffChain(OffChainCircuitSource {
            source: "https://gateway.pinata.cloud/ipfs/QmQ4Jd2KEQZXPzE5xgXGQTz8BjtF4BHemSsjXWaE3QTuGT".to_string(),
            hash: circuit_hash!("add_together"),
        })),
        None,
    )?;
    Ok(())
}

