def vprint(verbose, *args, **kwargs):
    """Print only if verbose is True."""
    if verbose:
        print(*args, **kwargs)