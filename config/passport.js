const LocalStrategy = require('passport-local').Strategy;
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const bcrypt = require('bcryptjs');
const User = require('../models/User');

module.exports = (passport) => {

  // =========================
  // Local Strategy (LOGIN)
  // =========================
  passport.use(
    new LocalStrategy(
      { usernameField: 'email' },
      async (email, password, done) => {
        try {

          const user = await User.findOne({ email: email.toLowerCase() })
            .select('+password')
            .populate('queues');

          if (!user) {
            return done(null, false, { message: 'Email não encontrado' });
          }

          if (!user.password) {
            return done(null, false, { message: 'Usuário sem senha cadastrada' });
          }

          if (!user.isActive) {
            return done(null, false, {
              message: 'Conta desativada. Entre em contato com o administrador.'
            });
          }

          const isMatch = await bcrypt.compare(password, user.password);

          if (!isMatch) {
            return done(null, false, { message: 'Senha incorreta' });
          }

          // Atualiza último login
          user.lastLogin = new Date();
          await user.save();

          return done(null, user);

        } catch (err) {
          return done(err);
        }
      }
    )
  );

  // =========================
  // JWT Strategy
  // =========================
  const jwtOptions = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: process.env.JWT_SECRET
  };

  passport.use(
    new JwtStrategy(jwtOptions, async (jwtPayload, done) => {
      try {

        const user = await User.findById(jwtPayload.id).populate('queues');

        if (user) {
          return done(null, user);
        }

        return done(null, false);

      } catch (err) {
        return done(err, false);
      }
    })
  );

  // =========================
  // Serialize / Deserialize
  // =========================
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {

      const user = await User.findById(id).populate('queues');

      done(null, user);

    } catch (err) {
      done(err);
    }
  });

};