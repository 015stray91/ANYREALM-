package com.anyrealm.builder

import android.app.Application

/**
 * Present so the manifest has a named Application rather than the framework default.
 *
 * There is nothing to initialise: OkHttp and DataStore both work lazily, and doing
 * network setup in `onCreate` would run on the main thread before the first frame.
 * Keeping this class empty is deliberate -- an empty class that exists is easier to
 * grow than a missing one, and it gives crash logs a stable class name.
 */
class AnyRealmApplication : Application()
